jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/models/tenant.model');
jest.mock('../../../src/services/ride.service');
jest.mock('../../../src/services/email');
jest.mock('../../../src/services/email/templates/invoice-authorized');
jest.mock('../../../src/services/email/templates/verify-email');
jest.mock('../../../src/services/email/templates/payment-proof-submitted');
jest.mock('../../../src/services/email/templates/payment-reviewed');
jest.mock('../../../src/services/email/templates/subscription-renewal-due');
jest.mock('../../../src/services/email/templates/subscription-expired');

jest.mock('../../../src/config', () => ({
  db: { host: 'localhost', port: 5432, database: 'test', user: 'test', password: '', ssl: false },
  appEnv: 'production',
  email: { from: 'noreply@comprobify.test', fromDocuments: 'facturas@comprobify.test' },
  appBaseUrl: 'https://api.comprobify.test',
  verificationTokenTtlHours: 24,
  adminNotificationEmail: '',
  bankTransfer: { bankName: 'Banco Pichincha', accountNumber: '123456' },
}));

const issuerModel = require('../../../src/models/issuer.model');
const tenantModel = require('../../../src/models/tenant.model');
const rideService = require('../../../src/services/ride.service');
const emailFactory = require('../../../src/services/email');
const invoiceAuthorizedTemplate = require('../../../src/services/email/templates/invoice-authorized');
const verifyEmailTemplate = require('../../../src/services/email/templates/verify-email');
const paymentProofSubmittedTemplate = require('../../../src/services/email/templates/payment-proof-submitted');
const paymentReviewedTemplate = require('../../../src/services/email/templates/payment-reviewed');
const subscriptionRenewalDueTemplate = require('../../../src/services/email/templates/subscription-renewal-due');
const subscriptionExpiredTemplate = require('../../../src/services/email/templates/subscription-expired');
const config = require('../../../src/config');
const emailService = require('../../../src/services/email.service');

describe('EmailService', () => {
  let mockSend;

  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({ messageId: '<generated-message-id>' });
    emailFactory.getProvider.mockReturnValue({ send: mockSend });
    config.adminNotificationEmail = '';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendInvoiceAuthorized', () => {
    const document = {
      id: 1,
      issuer_id: 5,
      buyer_email: 'buyer@example.com',
      access_key: '2602202601171234567800110010010000002630000026311',
      authorization_xml: '<autorizacion>xml</autorizacion>',
    };
    const issuer = { id: 5, tenant_id: 10, business_name: 'ACME S.A.' };

    beforeEach(() => {
      issuerModel.findById.mockResolvedValue(issuer);
      tenantModel.findById.mockResolvedValue({ id: 10, preferred_language: 'es' });
      rideService.generate.mockResolvedValue(Buffer.from('PDF-BYTES'));
      invoiceAuthorizedTemplate.render.mockReturnValue({
        subject: 'Invoice authorized',
        text: 'text body',
        html: '<p>html body</p>',
      });
    });

    test('returns sent:false with reason no_email when the document has no buyer_email, without looking up the issuer', async () => {
      const result = await emailService.sendInvoiceAuthorized({ ...document, buyer_email: null });

      expect(result).toEqual({ sent: false, reason: 'no_email' });
      expect(issuerModel.findById).not.toHaveBeenCalled();
      expect(emailFactory.getProvider).not.toHaveBeenCalled();
    });

    test('sends the RIDE PDF and XML attachments with the issuer business name as sender', async () => {
      const result = await emailService.sendInvoiceAuthorized(document);

      expect(issuerModel.findById).toHaveBeenCalledWith(5);
      expect(tenantModel.findById).toHaveBeenCalledWith(10);
      expect(rideService.generate).toHaveBeenCalledWith(document);
      expect(mockSend).toHaveBeenCalledWith({
        from: 'ACME S.A. via Comprobify <facturas@comprobify.test>',
        to: 'buyer@example.com',
        subject: 'Invoice authorized',
        text: 'text body',
        html: '<p>html body</p>',
        attachments: [
          {
            filename: `RIDE-${document.access_key}.pdf`,
            data: Buffer.from('PDF-BYTES'),
            contentType: 'application/pdf',
          },
          {
            filename: `${document.access_key}.xml`,
            data: Buffer.from(document.authorization_xml, 'utf8'),
            contentType: 'application/xml',
          },
        ],
      });
      expect(result).toEqual({ sent: true, messageId: '<generated-message-id>' });
    });

    test('renders the invoice-authorized template using the tenant preferred_language', async () => {
      tenantModel.findById.mockResolvedValue({ id: 10, preferred_language: 'en' });

      await emailService.sendInvoiceAuthorized(document);

      expect(invoiceAuthorizedTemplate.render).toHaveBeenCalledWith(document, issuer, 'en');
    });

    test('falls back to "es" when the tenant has no preferred_language set', async () => {
      tenantModel.findById.mockResolvedValue({ id: 10, preferred_language: null });

      await emailService.sendInvoiceAuthorized(document);

      expect(invoiceAuthorizedTemplate.render).toHaveBeenCalledWith(document, issuer, 'es');
    });

    test('propagates the error when the provider send fails', async () => {
      mockSend.mockRejectedValue(new Error('mailgun down'));

      await expect(emailService.sendInvoiceAuthorized(document)).rejects.toThrow('mailgun down');
    });
  });

  describe('sendVerificationEmail', () => {
    beforeEach(() => {
      verifyEmailTemplate.render.mockReturnValue({
        subject: 'Verify your email',
        text: 'text body',
        html: '<p>html body</p>',
      });
    });

    test('builds the verification URL from appBaseUrl when no redirectUrl is given', async () => {
      await emailService.sendVerificationEmail('tenant@example.com', 'tok-123');

      expect(verifyEmailTemplate.render).toHaveBeenCalledWith(
        'https://api.comprobify.test/v1/verify-email?token=tok-123',
        24,
        'es'
      );
    });

    test('uses the supplied redirectUrl when given, appending the token', async () => {
      await emailService.sendVerificationEmail('tenant@example.com', 'tok-123', 'https://app.example.com/verify');

      expect(verifyEmailTemplate.render).toHaveBeenCalledWith(
        'https://app.example.com/verify?token=tok-123',
        24,
        'es'
      );
    });

    test('passes through a custom language', async () => {
      await emailService.sendVerificationEmail('tenant@example.com', 'tok-123', null, 'en');

      expect(verifyEmailTemplate.render).toHaveBeenCalledWith(
        'https://api.comprobify.test/v1/verify-email?token=tok-123',
        24,
        'en'
      );
    });

    test('sends from "Comprobify" (platform sender), not an issuer name, and returns messageId', async () => {
      const result = await emailService.sendVerificationEmail('tenant@example.com', 'tok-123');

      expect(mockSend).toHaveBeenCalledWith({
        from: 'Comprobify <noreply@comprobify.test>',
        to: 'tenant@example.com',
        subject: 'Verify your email',
        text: 'text body',
        html: '<p>html body</p>',
        attachments: [],
      });
      expect(result).toEqual({ messageId: '<generated-message-id>' });
    });
  });

  describe('sendPaymentProofSubmitted', () => {
    const payment = { id: 1, subscription_id: 10 };
    const subscription = { id: 10, tier: 'STARTER' };
    const tenant = { id: 20, business_name: 'ACME S.A.' };

    test('is a no-op when ADMIN_NOTIFICATION_EMAIL is unset', async () => {
      config.adminNotificationEmail = '';

      const result = await emailService.sendPaymentProofSubmitted(payment, subscription, tenant);

      expect(result).toEqual({ sent: false, reason: 'no_admin_email' });
      expect(paymentProofSubmittedTemplate.render).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    test('notifies the operator email when ADMIN_NOTIFICATION_EMAIL is set', async () => {
      config.adminNotificationEmail = 'ops@comprobify.test';
      paymentProofSubmittedTemplate.render.mockReturnValue({
        subject: 'Proof submitted',
        text: 'text body',
        html: '<p>html body</p>',
      });

      const result = await emailService.sendPaymentProofSubmitted(payment, subscription, tenant);

      expect(paymentProofSubmittedTemplate.render).toHaveBeenCalledWith(payment, subscription, tenant);
      expect(mockSend).toHaveBeenCalledWith({
        from: 'Comprobify <noreply@comprobify.test>',
        to: 'ops@comprobify.test',
        subject: 'Proof submitted',
        text: 'text body',
        html: '<p>html body</p>',
        attachments: [],
      });
      expect(result).toEqual({ sent: true });
    });
  });

  describe('sendPaymentReviewed', () => {
    const payment = { id: 1, subscription_id: 10 };
    const subscription = { id: 10, tenant_id: 20 };

    beforeEach(() => {
      paymentReviewedTemplate.render.mockReturnValue({
        subject: 'Payment reviewed',
        text: 'text body',
        html: '<p>html body</p>',
      });
    });

    test('looks up the tenant and sends to their email, using the platform sender name', async () => {
      tenantModel.findById.mockResolvedValue({ id: 20, email: 'tenant@example.com', preferred_language: 'es' });

      const result = await emailService.sendPaymentReviewed(payment, subscription, 'VERIFIED');

      expect(tenantModel.findById).toHaveBeenCalledWith(20);
      expect(paymentReviewedTemplate.render).toHaveBeenCalledWith(payment, subscription, 'VERIFIED', 'es');
      expect(mockSend).toHaveBeenCalledWith({
        from: 'Comprobify <noreply@comprobify.test>',
        to: 'tenant@example.com',
        subject: 'Payment reviewed',
        text: 'text body',
        html: '<p>html body</p>',
        attachments: [],
      });
      expect(result).toEqual({ sent: true });
    });

    test('passes the REJECTED decision through to the template', async () => {
      tenantModel.findById.mockResolvedValue({ id: 20, email: 'tenant@example.com', preferred_language: 'es' });

      await emailService.sendPaymentReviewed(payment, subscription, 'REJECTED');

      expect(paymentReviewedTemplate.render).toHaveBeenCalledWith(payment, subscription, 'REJECTED', 'es');
    });

    test('falls back to "es" when the tenant has no preferred_language set', async () => {
      tenantModel.findById.mockResolvedValue({ id: 20, email: 'tenant@example.com', preferred_language: undefined });

      await emailService.sendPaymentReviewed(payment, subscription, 'VERIFIED');

      expect(paymentReviewedTemplate.render).toHaveBeenCalledWith(payment, subscription, 'VERIFIED', 'es');
    });
  });

  describe('sendSubscriptionRenewalDue', () => {
    const subscription = { id: 10, tenant_id: 20 };
    const payment = { id: 1, purpose: 'RENEWAL' };

    beforeEach(() => {
      subscriptionRenewalDueTemplate.render.mockReturnValue({
        subject: 'Renewal due',
        text: 'text body',
        html: '<p>html body</p>',
      });
    });

    test('looks up the tenant, renders with bank transfer instructions, and sends', async () => {
      tenantModel.findById.mockResolvedValue({ id: 20, email: 'tenant@example.com', preferred_language: 'en' });

      const result = await emailService.sendSubscriptionRenewalDue(subscription, payment);

      expect(tenantModel.findById).toHaveBeenCalledWith(20);
      expect(subscriptionRenewalDueTemplate.render).toHaveBeenCalledWith(
        subscription, payment, config.bankTransfer, 'en'
      );
      expect(mockSend).toHaveBeenCalledWith({
        from: 'Comprobify <noreply@comprobify.test>',
        to: 'tenant@example.com',
        subject: 'Renewal due',
        text: 'text body',
        html: '<p>html body</p>',
        attachments: [],
      });
      expect(result).toEqual({ sent: true });
    });

    test('falls back to "es" when the tenant has no preferred_language set', async () => {
      tenantModel.findById.mockResolvedValue({ id: 20, email: 'tenant@example.com', preferred_language: null });

      await emailService.sendSubscriptionRenewalDue(subscription, payment);

      expect(subscriptionRenewalDueTemplate.render).toHaveBeenCalledWith(
        subscription, payment, config.bankTransfer, 'es'
      );
    });
  });

  describe('sendSubscriptionExpired', () => {
    const subscription = { id: 10, tenant_id: 20, tier: 'GROWTH' };

    beforeEach(() => {
      subscriptionExpiredTemplate.render.mockReturnValue({
        subject: 'Subscription expired',
        text: 'text body',
        html: '<p>html body</p>',
      });
    });

    test('looks up the tenant and sends the expiry notice', async () => {
      tenantModel.findById.mockResolvedValue({ id: 20, email: 'tenant@example.com', preferred_language: 'es' });

      const result = await emailService.sendSubscriptionExpired(subscription);

      expect(tenantModel.findById).toHaveBeenCalledWith(20);
      expect(subscriptionExpiredTemplate.render).toHaveBeenCalledWith(subscription, 'es');
      expect(mockSend).toHaveBeenCalledWith({
        from: 'Comprobify <noreply@comprobify.test>',
        to: 'tenant@example.com',
        subject: 'Subscription expired',
        text: 'text body',
        html: '<p>html body</p>',
        attachments: [],
      });
      expect(result).toEqual({ sent: true });
    });

    test('falls back to "es" when the tenant has no preferred_language set', async () => {
      tenantModel.findById.mockResolvedValue({ id: 20, email: 'tenant@example.com', preferred_language: undefined });

      await emailService.sendSubscriptionExpired(subscription);

      expect(subscriptionExpiredTemplate.render).toHaveBeenCalledWith(subscription, 'es');
    });
  });

  describe('staging environment banner', () => {
    afterEach(() => {
      config.appEnv = 'production';
    });

    test('does not alter text/html when appEnv is production', async () => {
      config.appEnv = 'production';
      subscriptionExpiredTemplate.render.mockReturnValue({
        subject: 'Subscription expired',
        text: 'text body',
        html: '<p>html body</p>',
      });
      tenantModel.findById.mockResolvedValue({ id: 20, email: 'tenant@example.com', preferred_language: 'es' });

      await emailService.sendSubscriptionExpired({ id: 10, tenant_id: 20, tier: 'GROWTH' });

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        text: 'text body',
        html: '<p>html body</p>',
      }));
    });

    test('prepends the banner to a fragment-style template (no <body> tag)', async () => {
      config.appEnv = 'staging';
      subscriptionExpiredTemplate.render.mockReturnValue({
        subject: 'Subscription expired',
        text: 'text body',
        html: '<p>html body</p>',
      });
      tenantModel.findById.mockResolvedValue({ id: 20, email: 'tenant@example.com', preferred_language: 'es' });

      await emailService.sendSubscriptionExpired({ id: 10, tenant_id: 20, tier: 'GROWTH' });

      const sentArgs = mockSend.mock.calls[0][0];
      expect(sentArgs.text).toBe(
        'ENTORNO DE PRUEBAS — este mensaje fue generado por un sistema de staging y no refleja una transacción real.\n\ntext body'
      );
      expect(sentArgs.html).toBe(
        '<div style="background:#fff3cd;border:1px solid #ffeeba;color:#856404;padding:10px 16px;margin-bottom:16px;border-radius:4px;font-weight:bold;">ENTORNO DE PRUEBAS — este mensaje fue generado por un sistema de staging y no refleja una transacción real.</div>\n<p>html body</p>'
      );
    });

    test('inserts the banner right after <body> for a full-document-style template', async () => {
      config.appEnv = 'staging';
      subscriptionExpiredTemplate.render.mockReturnValue({
        subject: 'Subscription expired',
        text: 'text body',
        html: '<!DOCTYPE html><html><body style="margin:0;"><p>html body</p></body></html>',
      });
      tenantModel.findById.mockResolvedValue({ id: 20, email: 'tenant@example.com', preferred_language: 'en' });

      await emailService.sendSubscriptionExpired({ id: 10, tenant_id: 20, tier: 'GROWTH' });

      const sentArgs = mockSend.mock.calls[0][0];
      expect(sentArgs.html).toBe(
        '<!DOCTYPE html><html><body style="margin:0;">\n<div style="background:#fff3cd;border:1px solid #ffeeba;color:#856404;padding:10px 16px;margin-bottom:16px;border-radius:4px;font-weight:bold;">TEST ENVIRONMENT — this message was generated by a staging system and does not reflect a real transaction.</div><p>html body</p></body></html>'
      );
    });

    test('uses the invoice-authorized fromDocuments sender while still applying the banner', async () => {
      config.appEnv = 'staging';
      const document = {
        id: 1,
        issuer_id: 5,
        buyer_email: 'buyer@example.com',
        access_key: '2602202601171234567800110010010000002630000026311',
        authorization_xml: '<autorizacion>xml</autorizacion>',
      };
      issuerModel.findById.mockResolvedValue({ id: 5, tenant_id: 10, business_name: 'ACME S.A.' });
      tenantModel.findById.mockResolvedValue({ id: 10, preferred_language: 'es' });
      rideService.generate.mockResolvedValue(Buffer.from('PDF-BYTES'));
      invoiceAuthorizedTemplate.render.mockReturnValue({
        subject: 'Invoice authorized',
        text: 'text body',
        html: '<p>html body</p>',
      });

      await emailService.sendInvoiceAuthorized(document);

      const sentArgs = mockSend.mock.calls[0][0];
      expect(sentArgs.from).toBe('ACME S.A. via Comprobify <facturas@comprobify.test>');
      expect(sentArgs.text).toContain('ENTORNO DE PRUEBAS');
      expect(sentArgs.html).toContain('ENTORNO DE PRUEBAS');
    });
  });
});
