jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/document-event.model');
jest.mock('../../../src/services/email.service');

const documentModel = require('../../../src/models/document.model');
const documentEventModel = require('../../../src/models/document-event.model');
const emailService = require('../../../src/services/email.service');
const documentEmailService = require('../../../src/services/document-email.service');

const mockIssuer = { id: 5, sandbox: false };

describe('DocumentEmailService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('retryFailedEmails', () => {
    test('returns zero counts when there are no pending emails', async () => {
      documentModel.findPendingEmails.mockResolvedValue([]);

      const result = await documentEmailService.retryFailedEmails(mockIssuer);

      expect(documentModel.findPendingEmails).toHaveBeenCalledWith(5, false);
      expect(result).toEqual({ sent: 0, failed: 0 });
      expect(emailService.sendInvoiceAuthorized).not.toHaveBeenCalled();
    });

    test('sends a pending email, updates status to SENT, and logs EMAIL_SENT', async () => {
      const doc = { id: 1, status: 'AUTHORIZED', buyer_email: 'buyer@example.com' };
      documentModel.findPendingEmails.mockResolvedValue([doc]);
      emailService.sendInvoiceAuthorized.mockResolvedValue({ messageId: 'msg-1' });
      documentModel.updateStatus.mockResolvedValue({ ...doc, email_status: 'SENT' });

      const result = await documentEmailService.retryFailedEmails(mockIssuer);

      expect(emailService.sendInvoiceAuthorized).toHaveBeenCalledWith(doc);
      expect(documentModel.updateStatus).toHaveBeenCalledWith(1, 'AUTHORIZED', {
        email_status: 'SENT',
        email_sent_at: expect.any(Date),
        email_error: null,
        email_message_id: 'msg-1',
      }, 5, false);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        1, 'EMAIL_SENT', null, null, { to: 'buyer@example.com', retried: true }, null, 5, false
      );
      expect(result).toEqual({ sent: 1, failed: 0 });
    });

    test('records a failure, updates status to FAILED, and logs EMAIL_FAILED without throwing', async () => {
      const doc = { id: 2, status: 'AUTHORIZED', buyer_email: 'buyer@example.com' };
      documentModel.findPendingEmails.mockResolvedValue([doc]);
      emailService.sendInvoiceAuthorized.mockRejectedValue(new Error('Mailgun down'));
      documentModel.updateStatus.mockResolvedValue({ ...doc, email_status: 'FAILED' });

      const result = await documentEmailService.retryFailedEmails(mockIssuer);

      expect(documentModel.updateStatus).toHaveBeenCalledWith(2, 'AUTHORIZED', {
        email_status: 'FAILED',
        email_error: 'Mailgun down',
      }, 5, false);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        2, 'EMAIL_FAILED', null, null, { error: 'Mailgun down', retried: true }, null, 5, false
      );
      expect(result).toEqual({ sent: 0, failed: 1 });
    });

    test('processes a mix of documents and tallies sent/failed independently', async () => {
      const doc1 = { id: 1, status: 'AUTHORIZED', buyer_email: 'a@example.com' };
      const doc2 = { id: 2, status: 'AUTHORIZED', buyer_email: 'b@example.com' };
      documentModel.findPendingEmails.mockResolvedValue([doc1, doc2]);
      emailService.sendInvoiceAuthorized
        .mockResolvedValueOnce({ messageId: 'msg-1' })
        .mockRejectedValueOnce(new Error('bounce'));
      documentModel.updateStatus.mockResolvedValue({});

      const result = await documentEmailService.retryFailedEmails(mockIssuer);

      expect(result).toEqual({ sent: 1, failed: 1 });
    });
  });

  describe('retrySingleEmail', () => {
    const accessKey = '1234567890123456789012345678901234567890123456789';

    test('throws NotFoundError when the document does not exist', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);

      await expect(documentEmailService.retrySingleEmail(accessKey, {}, mockIssuer))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(emailService.sendInvoiceAuthorized).not.toHaveBeenCalled();
    });

    test('throws when the document is not AUTHORIZED', async () => {
      documentModel.findByAccessKey.mockResolvedValue({ id: 1, status: 'SIGNED' });

      await expect(documentEmailService.retrySingleEmail(accessKey, {}, mockIssuer))
        .rejects.toMatchObject({ statusCode: 400, code: 'DOCUMENT_NOT_AUTHORIZED' });
      expect(emailService.sendInvoiceAuthorized).not.toHaveBeenCalled();
    });

    test('marks email SKIPPED and returns no_email when the document has no buyer_email', async () => {
      documentModel.findByAccessKey.mockResolvedValue({ id: 1, status: 'AUTHORIZED', buyer_email: null });
      documentModel.updateStatus.mockResolvedValue({});

      const result = await documentEmailService.retrySingleEmail(accessKey, {}, mockIssuer);

      expect(documentModel.updateStatus).toHaveBeenCalledWith(1, 'AUTHORIZED', { email_status: 'SKIPPED' }, 5, false);
      expect(result).toEqual({ sent: false, reason: 'no_email' });
      expect(emailService.sendInvoiceAuthorized).not.toHaveBeenCalled();
    });

    test('returns already_sent without resending when email_status is SENT and force is not set', async () => {
      documentModel.findByAccessKey.mockResolvedValue({
        id: 1, status: 'AUTHORIZED', buyer_email: 'buyer@example.com', email_status: 'SENT',
      });

      const result = await documentEmailService.retrySingleEmail(accessKey, {}, mockIssuer);

      expect(result).toEqual({ sent: false, reason: 'already_sent' });
      expect(emailService.sendInvoiceAuthorized).not.toHaveBeenCalled();
    });

    test('treats DELIVERED and COMPLAINED as already sent too', async () => {
      documentModel.findByAccessKey.mockResolvedValueOnce({
        id: 1, status: 'AUTHORIZED', buyer_email: 'buyer@example.com', email_status: 'DELIVERED',
      });
      const resultDelivered = await documentEmailService.retrySingleEmail(accessKey, {}, mockIssuer);
      expect(resultDelivered).toEqual({ sent: false, reason: 'already_sent' });

      documentModel.findByAccessKey.mockResolvedValueOnce({
        id: 1, status: 'AUTHORIZED', buyer_email: 'buyer@example.com', email_status: 'COMPLAINED',
      });
      const resultComplained = await documentEmailService.retrySingleEmail(accessKey, {}, mockIssuer);
      expect(resultComplained).toEqual({ sent: false, reason: 'already_sent' });

      expect(emailService.sendInvoiceAuthorized).not.toHaveBeenCalled();
    });

    test('force=true resends even when already SENT', async () => {
      documentModel.findByAccessKey.mockResolvedValue({
        id: 1, status: 'AUTHORIZED', buyer_email: 'buyer@example.com', email_status: 'SENT',
      });
      emailService.sendInvoiceAuthorized.mockResolvedValue({ messageId: 'msg-2' });
      documentModel.updateStatus.mockResolvedValue({});

      const result = await documentEmailService.retrySingleEmail(accessKey, { force: true }, mockIssuer);

      expect(emailService.sendInvoiceAuthorized).toHaveBeenCalled();
      expect(result).toEqual({ sent: true });
    });

    test('sends, updates status to SENT, logs EMAIL_SENT, returns sent=true', async () => {
      const document = { id: 1, status: 'AUTHORIZED', buyer_email: 'buyer@example.com', email_status: 'PENDING' };
      documentModel.findByAccessKey.mockResolvedValue(document);
      emailService.sendInvoiceAuthorized.mockResolvedValue({ messageId: 'msg-3' });
      documentModel.updateStatus.mockResolvedValue({});

      const result = await documentEmailService.retrySingleEmail(accessKey, {}, mockIssuer);

      expect(emailService.sendInvoiceAuthorized).toHaveBeenCalledWith(document);
      expect(documentModel.updateStatus).toHaveBeenCalledWith(1, 'AUTHORIZED', {
        email_status: 'SENT',
        email_sent_at: expect.any(Date),
        email_error: null,
        email_message_id: 'msg-3',
      }, 5, false);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        1, 'EMAIL_SENT', null, null, { to: 'buyer@example.com', retried: true }, null, 5, false
      );
      expect(result).toEqual({ sent: true });
    });

    test('on send failure, updates status to FAILED, logs EMAIL_FAILED, and re-throws', async () => {
      const document = { id: 1, status: 'AUTHORIZED', buyer_email: 'buyer@example.com', email_status: 'PENDING' };
      documentModel.findByAccessKey.mockResolvedValue(document);
      emailService.sendInvoiceAuthorized.mockRejectedValue(new Error('SMTP timeout'));
      documentModel.updateStatus.mockResolvedValue({});

      await expect(documentEmailService.retrySingleEmail(accessKey, {}, mockIssuer))
        .rejects.toThrow('SMTP timeout');

      expect(documentModel.updateStatus).toHaveBeenCalledWith(1, 'AUTHORIZED', {
        email_status: 'FAILED',
        email_error: 'SMTP timeout',
      }, 5, false);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        1, 'EMAIL_FAILED', null, null, { error: 'SMTP timeout', retried: true }, null, 5, false
      );
    });
  });
});
