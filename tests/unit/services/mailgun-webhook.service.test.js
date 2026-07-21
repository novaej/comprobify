jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/document-event.model');
jest.mock('../../../src/models/tenant.model');
jest.mock('../../../src/models/tenant-event.model');

const documentModel = require('../../../src/models/document.model');
const documentEventModel = require('../../../src/models/document-event.model');
const tenantModel = require('../../../src/models/tenant.model');
const tenantEventModel = require('../../../src/models/tenant-event.model');
const mailgunWebhookService = require('../../../src/services/mailgun-webhook.service');

describe('MailgunWebhookService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processEvent — payload normalisation / guard branches', () => {
    test('is a no-op when the event field is missing (v3 format)', async () => {
      await mailgunWebhookService.processEvent({
        'event-data': { message: { headers: { 'message-id': '<abc@mailgun>' } } },
      });

      expect(documentModel.findByEmailMessageId).not.toHaveBeenCalled();
    });

    test('is a no-op when the message id is missing (legacy format)', async () => {
      await mailgunWebhookService.processEvent({ event: 'delivered' });

      expect(documentModel.findByEmailMessageId).not.toHaveBeenCalled();
    });

    test('is a no-op for an unhandled event type', async () => {
      await mailgunWebhookService.processEvent({ event: 'opened', 'message-id': '<abc@mailgun>' });

      expect(documentModel.findByEmailMessageId).not.toHaveBeenCalled();
    });

    test('is a no-op when neither a document nor a tenant matches the message id', async () => {
      documentModel.findByEmailMessageId.mockResolvedValue(null);
      tenantModel.findByVerificationEmailMessageId.mockResolvedValue(null);

      await mailgunWebhookService.processEvent({ event: 'delivered', 'message-id': '<abc@mailgun>' });

      expect(documentEventModel.create).not.toHaveBeenCalled();
      expect(tenantEventModel.create).not.toHaveBeenCalled();
    });

    test('strips angle brackets from the v3 message-id before lookup', async () => {
      documentModel.findByEmailMessageId.mockResolvedValue(null);
      tenantModel.findByVerificationEmailMessageId.mockResolvedValue(null);

      await mailgunWebhookService.processEvent({
        'event-data': {
          event: 'delivered',
          message: { headers: { 'message-id': '<abc@mailgun.org>' } },
          recipient: 'buyer@example.com',
        },
      });

      expect(documentModel.findByEmailMessageId).toHaveBeenCalledWith('abc@mailgun.org');
    });

    test('strips angle brackets from the legacy message-id before lookup', async () => {
      documentModel.findByEmailMessageId.mockResolvedValue(null);
      tenantModel.findByVerificationEmailMessageId.mockResolvedValue(null);

      await mailgunWebhookService.processEvent({ event: 'delivered', 'message-id': '<xyz@mailgun.org>' });

      expect(documentModel.findByEmailMessageId).toHaveBeenCalledWith('xyz@mailgun.org');
    });
  });

  describe('processEvent — document event handling', () => {
    const document = { id: '00000000-0000-0000-0000-000000000042', issuer_id: '00000000-0000-0000-0000-000000000007', sandbox: false };

    test('delivered: updates email_status to DELIVERED and logs EMAIL_DELIVERED', async () => {
      documentModel.findByEmailMessageId.mockResolvedValue(document);

      await mailgunWebhookService.processEvent({
        event: 'delivered', 'message-id': '<abc@mailgun>', recipient: 'buyer@example.com',
      });

      expect(documentModel.updateEmailStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000042', 'DELIVERED', false);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000042', 'EMAIL_DELIVERED', null, null, { to: 'buyer@example.com' }, null, '00000000-0000-0000-0000-000000000007', false
      );
      expect(tenantModel.findByVerificationEmailMessageId).not.toHaveBeenCalled();
    });

    test('complained: updates email_status to COMPLAINED and logs EMAIL_COMPLAINED', async () => {
      documentModel.findByEmailMessageId.mockResolvedValue(document);

      await mailgunWebhookService.processEvent({
        event: 'complained', 'message-id': '<abc@mailgun>', recipient: 'buyer@example.com',
      });

      expect(documentModel.updateEmailStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000042', 'COMPLAINED', false);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000042', 'EMAIL_COMPLAINED', null, null, { to: 'buyer@example.com' }, null, '00000000-0000-0000-0000-000000000007', false
      );
    });

    test('failed + temporary: does not update email_status, only logs EMAIL_TEMP_FAILED', async () => {
      documentModel.findByEmailMessageId.mockResolvedValue(document);

      await mailgunWebhookService.processEvent({
        event: 'failed', severity: 'temporary', 'message-id': '<abc@mailgun>', recipient: 'buyer@example.com',
      });

      expect(documentModel.updateEmailStatus).not.toHaveBeenCalled();
      expect(documentEventModel.create).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000042', 'EMAIL_TEMP_FAILED', null, null, { to: 'buyer@example.com', severity: 'temporary' }, null, '00000000-0000-0000-0000-000000000007', false
      );
    });

    test('failed + permanent: updates email_status to FAILED and logs EMAIL_FAILED', async () => {
      documentModel.findByEmailMessageId.mockResolvedValue(document);

      await mailgunWebhookService.processEvent({
        event: 'failed', severity: 'permanent', 'message-id': '<abc@mailgun>', recipient: 'buyer@example.com',
      });

      expect(documentModel.updateEmailStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000042', 'FAILED', false);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000042', 'EMAIL_FAILED', null, null, { to: 'buyer@example.com', severity: 'permanent' }, null, '00000000-0000-0000-0000-000000000007', false
      );
    });

    test('failed without a severity is treated as permanent', async () => {
      documentModel.findByEmailMessageId.mockResolvedValue(document);

      await mailgunWebhookService.processEvent({
        event: 'failed', 'message-id': '<abc@mailgun>', recipient: 'buyer@example.com',
      });

      expect(documentModel.updateEmailStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000042', 'FAILED', false);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000042', 'EMAIL_FAILED', null, null, { to: 'buyer@example.com', severity: undefined }, null, '00000000-0000-0000-0000-000000000007', false
      );
    });

    test('passes the sandbox flag from the matched document through to both writes', async () => {
      documentModel.findByEmailMessageId.mockResolvedValue({ ...document, sandbox: true });

      await mailgunWebhookService.processEvent({
        event: 'delivered', 'message-id': '<abc@mailgun>', recipient: 'buyer@example.com',
      });

      expect(documentModel.updateEmailStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000042', 'DELIVERED', true);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000042', 'EMAIL_DELIVERED', null, null, { to: 'buyer@example.com' }, null, '00000000-0000-0000-0000-000000000007', true
      );
    });
  });

  describe('processEvent — tenant verification event handling', () => {
    const tenant = { id: '00000000-0000-0000-0000-000000000003' };

    beforeEach(() => {
      documentModel.findByEmailMessageId.mockResolvedValue(null);
      tenantModel.findByVerificationEmailMessageId.mockResolvedValue(tenant);
    });

    test('delivered: updates verification email status to DELIVERED and logs VERIFICATION_EMAIL_DELIVERED', async () => {
      await mailgunWebhookService.processEvent({
        event: 'delivered', 'message-id': '<verify@mailgun>', recipient: 'tenant@example.com',
      });

      expect(tenantModel.updateVerificationEmailStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000003', 'DELIVERED');
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000003', 'VERIFICATION_EMAIL_DELIVERED', { to: 'tenant@example.com' });
    });

    test('complained: updates verification email status to COMPLAINED and logs VERIFICATION_EMAIL_COMPLAINED', async () => {
      await mailgunWebhookService.processEvent({
        event: 'complained', 'message-id': '<verify@mailgun>', recipient: 'tenant@example.com',
      });

      expect(tenantModel.updateVerificationEmailStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000003', 'COMPLAINED');
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000003', 'VERIFICATION_EMAIL_COMPLAINED', { to: 'tenant@example.com' });
    });

    test('failed + temporary: does not update status, only logs VERIFICATION_EMAIL_TEMP_FAILED', async () => {
      await mailgunWebhookService.processEvent({
        event: 'failed', severity: 'temporary', 'message-id': '<verify@mailgun>', recipient: 'tenant@example.com',
      });

      expect(tenantModel.updateVerificationEmailStatus).not.toHaveBeenCalled();
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000003', 'VERIFICATION_EMAIL_TEMP_FAILED', {
        to: 'tenant@example.com', severity: 'temporary',
      });
    });

    test('failed + permanent: updates status to FAILED and logs VERIFICATION_EMAIL_FAILED', async () => {
      await mailgunWebhookService.processEvent({
        event: 'failed', severity: 'permanent', 'message-id': '<verify@mailgun>', recipient: 'tenant@example.com',
      });

      expect(tenantModel.updateVerificationEmailStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000003', 'FAILED');
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000003', 'VERIFICATION_EMAIL_FAILED', {
        to: 'tenant@example.com', severity: 'permanent',
      });
    });

    test('only looks up the tenant when no document matched', async () => {
      await mailgunWebhookService.processEvent({
        event: 'delivered', 'message-id': '<verify@mailgun>', recipient: 'tenant@example.com',
      });

      expect(documentModel.findByEmailMessageId).toHaveBeenCalledWith('verify@mailgun');
      expect(tenantModel.findByVerificationEmailMessageId).toHaveBeenCalledWith('verify@mailgun');
    });
  });
});
