jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/document-event.model');
jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/models/tenant.model');
jest.mock('../../../src/models/tenant-event.model');
jest.mock('../../../src/models/payment.model');
jest.mock('../../../src/models/subscription.model');
jest.mock('../../../src/models/notification.model');
jest.mock('../../../src/services/document-transmission.service');
jest.mock('../../../src/services/notification.service');
jest.mock('../../../src/services/subscription.service');
jest.mock('../../../src/services/email.service');
jest.mock('../../../src/services/webhook-delivery.service');
jest.mock('../../../src/services/tenant-agreement.service');

const documentModel = require('../../../src/models/document.model');
const documentEventModel = require('../../../src/models/document-event.model');
const issuerModel = require('../../../src/models/issuer.model');
const tenantModel = require('../../../src/models/tenant.model');
const tenantEventModel = require('../../../src/models/tenant-event.model');
const paymentModel = require('../../../src/models/payment.model');
const subscriptionModel = require('../../../src/models/subscription.model');
const notificationModel = require('../../../src/models/notification.model');
const documentTransmissionService = require('../../../src/services/document-transmission.service');
const notificationService = require('../../../src/services/notification.service');
const subscriptionService = require('../../../src/services/subscription.service');
const emailService = require('../../../src/services/email.service');
const webhookDeliveryService = require('../../../src/services/webhook-delivery.service');
const tenantAgreementService = require('../../../src/services/tenant-agreement.service');
const { getHandler } = require('../../../src/effects');

const mockIssuer = { id: 'issuer-1', tenant_id: 'tenant-1', sandbox: false };

afterEach(() => {
  jest.clearAllMocks();
});

describe('effects registry: getHandler', () => {
  test('throws for an unregistered effect type', () => {
    expect(() => getHandler('NOT_A_REAL_TYPE')).toThrow(/No effect handler registered/);
  });
});

describe('SRI_SEND handler', () => {
  test('resolves the issuer and delegates to documentTransmissionService.sendToSri', async () => {
    issuerModel.findById.mockResolvedValue({ id: 'issuer-1' });
    documentTransmissionService.sendToSri.mockResolvedValue({});

    await getHandler('SRI_SEND')({ accessKey: 'AK-1', issuerId: 'issuer-1', sandbox: true });

    expect(issuerModel.findById).toHaveBeenCalledWith('issuer-1');
    expect(documentTransmissionService.sendToSri).toHaveBeenCalledWith('AK-1', expect.objectContaining({ id: 'issuer-1', sandbox: true }));
  });
});

describe('SRI_AUTHORIZE handler', () => {
  test('passes through the { requeue: true } signal from checkAuthorization', async () => {
    issuerModel.findById.mockResolvedValue({ id: 'issuer-1' });
    documentTransmissionService.checkAuthorization.mockResolvedValue({ requeue: true });

    const result = await getHandler('SRI_AUTHORIZE')({ accessKey: 'AK-1', issuerId: 'issuer-1', sandbox: false });

    expect(result).toEqual({ requeue: true });
  });
});

describe('DOCUMENT_AUTHORIZED_NOTIFICATION handler', () => {
  test('resolves document + issuer and calls notificationService.createDocumentAuthorized', async () => {
    issuerModel.findById.mockResolvedValue(mockIssuer);
    const doc = { id: 'doc-1', access_key: 'AK-1' };
    documentModel.findByAccessKey.mockResolvedValue(doc);

    await getHandler('DOCUMENT_AUTHORIZED_NOTIFICATION')({ accessKey: 'AK-1', issuerId: 'issuer-1', sandbox: false });

    expect(notificationService.createDocumentAuthorized).toHaveBeenCalledWith(doc, expect.objectContaining({ id: 'issuer-1' }));
  });

  test('throws when the document cannot be found (handler retried by reconciliation, not silently dropped)', async () => {
    issuerModel.findById.mockResolvedValue(mockIssuer);
    documentModel.findByAccessKey.mockResolvedValue(null);

    await expect(getHandler('DOCUMENT_AUTHORIZED_NOTIFICATION')({ accessKey: 'AK-missing', issuerId: 'issuer-1', sandbox: false }))
      .rejects.toThrow(/not found/);
  });
});

describe('INVOICE_AUTHORIZED_EMAIL handler', () => {
  const doc = { id: 'doc-1', access_key: 'AK-1', status: 'AUTHORIZED', buyer_email: 'buyer@test.com' };

  beforeEach(() => {
    issuerModel.findById.mockResolvedValue(mockIssuer);
    documentModel.findByAccessKey.mockResolvedValue(doc);
  });

  test('on a successful send, stamps SENT/email_sent_at/message_id and logs EMAIL_SENT', async () => {
    emailService.sendInvoiceAuthorized.mockResolvedValue({ sent: true, messageId: 'msg-42' });

    await getHandler('INVOICE_AUTHORIZED_EMAIL')({ accessKey: 'AK-1', issuerId: 'issuer-1', sandbox: false });

    expect(documentModel.updateStatus).toHaveBeenCalledWith(
      doc.id, doc.status,
      expect.objectContaining({ email_status: 'SENT', email_message_id: 'msg-42', email_sent_at: expect.any(Date) }),
      mockIssuer.id, false
    );
    expect(documentEventModel.create).toHaveBeenCalledWith(
      doc.id, 'EMAIL_SENT', null, null, { to: doc.buyer_email }, null, mockIssuer.id, false
    );
  });

  test('when sending is intentionally skipped (e.g. no buyer_email), stamps SKIPPED and logs EMAIL_SKIPPED', async () => {
    emailService.sendInvoiceAuthorized.mockResolvedValue({ sent: false });

    await getHandler('INVOICE_AUTHORIZED_EMAIL')({ accessKey: 'AK-1', issuerId: 'issuer-1', sandbox: false });

    expect(documentModel.updateStatus).toHaveBeenCalledWith(doc.id, doc.status, { email_status: 'SKIPPED' }, mockIssuer.id, false);
    expect(documentEventModel.create).toHaveBeenCalledWith(
      doc.id, 'EMAIL_SKIPPED', null, null, { to: doc.buyer_email }, null, mockIssuer.id, false
    );
  });

  test('on failure, stamps FAILED/email_error, logs EMAIL_FAILED, and rethrows (so process() retries it)', async () => {
    emailService.sendInvoiceAuthorized.mockRejectedValue(new Error('mailgun unreachable'));

    await expect(getHandler('INVOICE_AUTHORIZED_EMAIL')({ accessKey: 'AK-1', issuerId: 'issuer-1', sandbox: false }))
      .rejects.toThrow('mailgun unreachable');

    expect(documentModel.updateStatus).toHaveBeenCalledWith(
      doc.id, doc.status, { email_status: 'FAILED', email_error: 'mailgun unreachable' }, mockIssuer.id, false
    );
    expect(documentEventModel.create).toHaveBeenCalledWith(
      doc.id, 'EMAIL_FAILED', null, null, { error: 'mailgun unreachable' }, null, mockIssuer.id, false
    );
  });
});

describe('TENANT_AGREEMENT_GENERATE handler', () => {
  test('delegates to tenantAgreementService.generateForTenant, letting it resolve the issuer itself', async () => {
    tenantAgreementService.generateForTenant.mockResolvedValue([]);

    await getHandler('TENANT_AGREEMENT_GENERATE')({ tenantId: 'tenant-1' });

    expect(tenantAgreementService.generateForTenant).toHaveBeenCalledWith('tenant-1');
  });
});

describe('VERIFICATION_EMAIL_SEND handler', () => {
  test('on success, stamps verification_email_sent and logs VERIFICATION_EMAIL_SENT', async () => {
    emailService.sendVerificationEmail.mockResolvedValue({ messageId: 'mg-1' });

    await getHandler('VERIFICATION_EMAIL_SEND')({
      tenantId: 'tenant-1', email: 'a@test.com', verificationToken: 'tok', redirectUrl: null, language: 'es',
    });

    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith('a@test.com', 'tok', null, 'es');
    expect(tenantModel.updateVerificationEmailSent).toHaveBeenCalledWith('tenant-1', 'mg-1');
    expect(tenantEventModel.create).toHaveBeenCalledWith('tenant-1', 'VERIFICATION_EMAIL_SENT');
  });

  test('on failure, logs VERIFICATION_EMAIL_FAILED and rethrows (so process() retries it)', async () => {
    emailService.sendVerificationEmail.mockRejectedValue(new Error('mailgun down'));

    await expect(getHandler('VERIFICATION_EMAIL_SEND')({
      tenantId: 'tenant-1', email: 'a@test.com', verificationToken: 'tok', redirectUrl: null, language: 'es',
    })).rejects.toThrow('mailgun down');

    expect(tenantEventModel.create).toHaveBeenCalledWith('tenant-1', 'VERIFICATION_EMAIL_FAILED', { error: 'mailgun down' });
    expect(tenantModel.updateVerificationEmailSent).not.toHaveBeenCalled();
  });
});

describe('WEBHOOK_FANOUT handler', () => {
  test('fetches the notification and delegates to webhookDeliveryService.fanOut', async () => {
    const notification = { id: 'notif-1', tenant_id: 'tenant-1', type: 'DOCUMENT_AUTHORIZED' };
    notificationModel.findById.mockResolvedValue(notification);

    await getHandler('WEBHOOK_FANOUT')({ notificationId: 'notif-1' });

    expect(webhookDeliveryService.fanOut).toHaveBeenCalledWith(notification);
  });

  test('is a no-op when the notification no longer exists', async () => {
    notificationModel.findById.mockResolvedValue(null);

    await getHandler('WEBHOOK_FANOUT')({ notificationId: 'notif-missing' });

    expect(webhookDeliveryService.fanOut).not.toHaveBeenCalled();
  });
});

describe('payment/subscription lifecycle handlers', () => {
  test('PAYMENT_REVIEWED_NOTIFICATION re-fetches payment + subscription and delegates', async () => {
    const payment = { id: 'payment-1' };
    const subscription = { id: 'sub-1' };
    paymentModel.findById.mockResolvedValue(payment);
    subscriptionModel.findById.mockResolvedValue(subscription);

    await getHandler('PAYMENT_REVIEWED_NOTIFICATION')({ paymentId: 'payment-1', subscriptionId: 'sub-1', decision: 'VERIFIED' });

    expect(notificationService.createPaymentReviewed).toHaveBeenCalledWith(payment, subscription, 'VERIFIED');
  });

  test('SUBSCRIPTION_EXPIRED_EMAIL re-fetches the subscription and delegates', async () => {
    const subscription = { id: 'sub-1', tier: 'GROWTH' };
    subscriptionModel.findById.mockResolvedValue(subscription);

    await getHandler('SUBSCRIPTION_EXPIRED_EMAIL')({ subscriptionId: 'sub-1' });

    expect(emailService.sendSubscriptionExpired).toHaveBeenCalledWith(subscription);
  });
});
