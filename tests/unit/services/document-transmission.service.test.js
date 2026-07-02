jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/document-event.model');
jest.mock('../../../src/services/sri.service');
jest.mock('../../../src/models/sri-response.model');
jest.mock('../../../src/services/email.service');
jest.mock('../../../src/services/notification.service');
jest.mock('../../../src/services/subscription.service');

const documentModel = require('../../../src/models/document.model');
const documentEventModel = require('../../../src/models/document-event.model');
const sriService = require('../../../src/services/sri.service');
const sriResponseModel = require('../../../src/models/sri-response.model');
const emailService = require('../../../src/services/email.service');
const notificationService = require('../../../src/services/notification.service');
const subscriptionService = require('../../../src/services/subscription.service');
const documentTransmission = require('../../../src/services/document-transmission.service');

const ACCESS_KEY = '1234567890123456789012345678901234567890123456789';

const mockIssuer = { id: 1, sandbox: false };

function baseDoc(overrides = {}) {
  return {
    id: 1,
    status: 'SIGNED',
    signed_xml: '<xml/>',
    access_key: ACCESS_KEY,
    document_type: '01',
    sequential: 1,
    issue_date: new Date('2026-01-01'),
    total: '100.00',
    buyer_id: '1712345678001',
    buyer_id_type: '05',
    buyer_name: 'BUYER',
    buyer_email: 'buyer@test.com',
    issuer_id: mockIssuer.id,
    ...overrides,
  };
}

describe('DocumentTransmissionService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendToSri', () => {
    test('throws NotFoundError when the document does not exist', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);

      await expect(documentTransmission.sendToSri(ACCESS_KEY, mockIssuer))
        .rejects.toMatchObject({ statusCode: 404 });
      expect(sriService.sendReceipt).not.toHaveBeenCalled();
    });

    test('throws on an invalid state transition (e.g. already AUTHORIZED)', async () => {
      documentModel.findByAccessKey.mockResolvedValue(baseDoc({ status: 'AUTHORIZED' }));

      await expect(documentTransmission.sendToSri(ACCESS_KEY, mockIssuer))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_STATE_TRANSITION' });
      expect(sriService.sendReceipt).not.toHaveBeenCalled();
    });

    test('logs an ERROR event and rethrows when sriService.sendReceipt throws', async () => {
      const doc = baseDoc();
      documentModel.findByAccessKey.mockResolvedValue(doc);
      const sriErr = new Error('network down');
      sriService.sendReceipt.mockRejectedValue(sriErr);

      await expect(documentTransmission.sendToSri(ACCESS_KEY, mockIssuer)).rejects.toThrow('network down');

      expect(documentEventModel.create).toHaveBeenCalledWith(
        doc.id, 'ERROR', 'SIGNED', null,
        { operation: 'SEND', message: 'network down' },
        null, mockIssuer.id, mockIssuer.sandbox
      );
      expect(documentModel.updateStatus).not.toHaveBeenCalled();
    });

    test('sets RECEIVED when SRI returns RECIBIDA', async () => {
      const doc = baseDoc();
      documentModel.findByAccessKey.mockResolvedValue(doc);
      sriService.sendReceipt.mockResolvedValue({ status: 'RECIBIDA', messages: [], rawResponse: '<raw/>' });
      sriResponseModel.create.mockResolvedValue({});
      documentModel.updateStatus.mockResolvedValue(baseDoc({ status: 'RECEIVED' }));
      documentEventModel.create.mockResolvedValue({});

      const result = await documentTransmission.sendToSri(ACCESS_KEY, mockIssuer);

      expect(sriResponseModel.create).toHaveBeenCalledWith(expect.objectContaining({
        documentId: doc.id, operationType: 'RECEPTION', status: 'RECIBIDA', sandbox: mockIssuer.sandbox,
      }));
      expect(documentModel.updateStatus).toHaveBeenCalledWith(doc.id, 'RECEIVED', {}, mockIssuer.id, mockIssuer.sandbox);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        doc.id, 'SENT', 'SIGNED', 'RECEIVED', { sriStatus: 'RECIBIDA' }, null, mockIssuer.id, mockIssuer.sandbox
      );
      expect(result.status).toBe('RECEIVED');
      expect(result.sriStatus).toBe('RECIBIDA');
      expect(result.processingRetry).toBeUndefined();
    });

    test('sets RECEIVED (with processingRetry) when SRI returns DEVUELTA with identifier 70', async () => {
      const doc = baseDoc();
      documentModel.findByAccessKey.mockResolvedValue(doc);
      sriService.sendReceipt.mockResolvedValue({
        status: 'DEVUELTA',
        messages: [{ identifier: '70', message: 'CLAVE DE ACCESO EN PROCESAMIENTO' }],
        rawResponse: '<raw/>',
      });
      sriResponseModel.create.mockResolvedValue({});
      documentModel.updateStatus.mockResolvedValue(baseDoc({ status: 'RECEIVED' }));
      documentEventModel.create.mockResolvedValue({});

      const result = await documentTransmission.sendToSri(ACCESS_KEY, mockIssuer);

      expect(documentModel.updateStatus).toHaveBeenCalledWith(doc.id, 'RECEIVED', {}, mockIssuer.id, mockIssuer.sandbox);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        doc.id, 'SENT', 'SIGNED', 'RECEIVED',
        expect.objectContaining({ processingRetry: true, sriIdentifier: '70' }),
        null, mockIssuer.id, mockIssuer.sandbox
      );
      expect(result.processingRetry).toBe(true);
    });

    test('sets RETURNED for a non-70 DEVUELTA response', async () => {
      const doc = baseDoc();
      documentModel.findByAccessKey.mockResolvedValue(doc);
      const messages = [{ identifier: '43', message: 'SOME OTHER ERROR' }];
      sriService.sendReceipt.mockResolvedValue({ status: 'DEVUELTA', messages, rawResponse: '<raw/>' });
      sriResponseModel.create.mockResolvedValue({});
      documentModel.updateStatus.mockResolvedValue(baseDoc({ status: 'RETURNED' }));
      documentEventModel.create.mockResolvedValue({});

      const result = await documentTransmission.sendToSri(ACCESS_KEY, mockIssuer);

      expect(documentModel.updateStatus).toHaveBeenCalledWith(doc.id, 'RETURNED', {}, mockIssuer.id, mockIssuer.sandbox);
      expect(result.status).toBe('RETURNED');
      expect(result.processingRetry).toBeUndefined();
      expect(result.sriMessages).toEqual(messages);
    });
  });

  describe('checkAuthorization', () => {
    beforeEach(() => {
      // Fire-and-forget side effects call `.catch`/`.then` on these directly —
      // they must resolve to a promise even when a test doesn't care about them.
      notificationService.createDocumentAuthorized.mockResolvedValue({});
      subscriptionService.activateIfLinked.mockResolvedValue();
      subscriptionService.applyTierChangeIfLinked.mockResolvedValue();
      subscriptionService.applyRenewalIfLinked.mockResolvedValue();
      emailService.sendInvoiceAuthorized.mockResolvedValue({ sent: true, messageId: 'msg-1' });
    });

    test('throws NotFoundError when the document does not exist', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);

      await expect(documentTransmission.checkAuthorization(ACCESS_KEY, mockIssuer))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    test('throws on an invalid state transition (e.g. still SIGNED)', async () => {
      documentModel.findByAccessKey.mockResolvedValue(baseDoc({ status: 'SIGNED' }));

      await expect(documentTransmission.checkAuthorization(ACCESS_KEY, mockIssuer))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_STATE_TRANSITION' });
      expect(sriService.checkAuthorization).not.toHaveBeenCalled();
    });

    test('logs an ERROR event and rethrows when sriService.checkAuthorization throws', async () => {
      const doc = baseDoc({ status: 'RECEIVED' });
      documentModel.findByAccessKey.mockResolvedValue(doc);
      sriService.checkAuthorization.mockRejectedValue(new Error('timeout'));

      await expect(documentTransmission.checkAuthorization(ACCESS_KEY, mockIssuer)).rejects.toThrow('timeout');

      expect(documentEventModel.create).toHaveBeenCalledWith(
        doc.id, 'ERROR', 'RECEIVED', null,
        { operation: 'AUTHORIZE', message: 'timeout' },
        null, mockIssuer.id, mockIssuer.sandbox
      );
      expect(documentModel.updateStatus).not.toHaveBeenCalled();
    });

    test('returns the unchanged document (no update, no event) when SRI reports pending', async () => {
      const doc = baseDoc({ status: 'RECEIVED' });
      documentModel.findByAccessKey.mockResolvedValue(doc);
      sriService.checkAuthorization.mockResolvedValue({ pending: true, status: null, messages: [], rawResponse: '<raw/>' });
      sriResponseModel.create.mockResolvedValue({});

      const result = await documentTransmission.checkAuthorization(ACCESS_KEY, mockIssuer);

      expect(documentModel.updateStatus).not.toHaveBeenCalled();
      expect(documentEventModel.create).not.toHaveBeenCalled();
      expect(result.status).toBe('RECEIVED');
    });

    test('sets NOT_AUTHORIZED and does not fire any authorization side effects', async () => {
      const doc = baseDoc({ status: 'RECEIVED' });
      documentModel.findByAccessKey.mockResolvedValue(doc);
      sriService.checkAuthorization.mockResolvedValue({
        pending: false, status: 'NO AUTORIZADO', messages: [{ identifier: '43', message: 'REJECTED' }], rawResponse: '<raw/>',
      });
      sriResponseModel.create.mockResolvedValue({});
      documentModel.updateStatus.mockResolvedValue(baseDoc({ status: 'NOT_AUTHORIZED' }));
      documentEventModel.create.mockResolvedValue({});

      const result = await documentTransmission.checkAuthorization(ACCESS_KEY, mockIssuer);

      expect(documentModel.updateStatus).toHaveBeenCalledWith(doc.id, 'NOT_AUTHORIZED', {}, mockIssuer.id, mockIssuer.sandbox);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        doc.id, 'STATUS_CHANGED', 'RECEIVED', 'NOT_AUTHORIZED',
        { sriStatus: 'NO AUTORIZADO', authorizationNumber: null },
        null, mockIssuer.id, mockIssuer.sandbox
      );
      expect(result.status).toBe('NOT_AUTHORIZED');
      expect(notificationService.createDocumentAuthorized).not.toHaveBeenCalled();
      expect(subscriptionService.activateIfLinked).not.toHaveBeenCalled();
      expect(subscriptionService.applyTierChangeIfLinked).not.toHaveBeenCalled();
      expect(subscriptionService.applyRenewalIfLinked).not.toHaveBeenCalled();
      expect(emailService.sendInvoiceAuthorized).not.toHaveBeenCalled();
    });

    test('sets AUTHORIZED, stores authorization fields, and fires every fire-and-forget side effect', async () => {
      const doc = baseDoc({ status: 'RECEIVED' });
      documentModel.findByAccessKey.mockResolvedValue(doc);
      sriService.checkAuthorization.mockResolvedValue({
        pending: false,
        status: 'AUTORIZADO',
        authorizationNumber: 'AUTH-123',
        authorizationDate: '2026-01-02T10:00:00-05:00',
        authorizationXml: '<factura/>',
        messages: [],
        rawResponse: '<raw/>',
      });
      sriResponseModel.create.mockResolvedValue({});
      const updatedDoc = baseDoc({ status: 'AUTHORIZED' });
      documentModel.updateStatus.mockResolvedValue(updatedDoc);
      documentEventModel.create.mockResolvedValue({});

      const result = await documentTransmission.checkAuthorization(ACCESS_KEY, mockIssuer);

      expect(documentModel.updateStatus).toHaveBeenCalledWith(doc.id, 'AUTHORIZED', {
        authorization_number: 'AUTH-123',
        authorization_date: '2026-01-02T10:00:00-05:00',
        authorization_xml: '<factura/>',
      }, mockIssuer.id, mockIssuer.sandbox);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        doc.id, 'STATUS_CHANGED', 'RECEIVED', 'AUTHORIZED',
        { sriStatus: 'AUTORIZADO', authorizationNumber: 'AUTH-123' },
        null, mockIssuer.id, mockIssuer.sandbox
      );
      expect(result.status).toBe('AUTHORIZED');

      // Fire-and-forget calls are issued synchronously (not awaited) — they
      // must already have been invoked by the time checkAuthorization resolves.
      expect(notificationService.createDocumentAuthorized).toHaveBeenCalledWith(updatedDoc, mockIssuer);
      expect(subscriptionService.activateIfLinked).toHaveBeenCalledWith(updatedDoc.id);
      expect(subscriptionService.applyTierChangeIfLinked).toHaveBeenCalledWith(updatedDoc.id);
      expect(subscriptionService.applyRenewalIfLinked).toHaveBeenCalledWith(updatedDoc.id);
      expect(emailService.sendInvoiceAuthorized).toHaveBeenCalledWith(updatedDoc);
    });

    test('checkAuthorization does not await the fire-and-forget email side effect before returning', async () => {
      const doc = baseDoc({ status: 'RECEIVED' });
      documentModel.findByAccessKey.mockResolvedValue(doc);
      sriService.checkAuthorization.mockResolvedValue({
        pending: false, status: 'AUTORIZADO', messages: [], rawResponse: '<raw/>',
      });
      sriResponseModel.create.mockResolvedValue({});
      const updatedDoc = baseDoc({ status: 'AUTHORIZED' });
      // First updateStatus call (the STATUS_CHANGED transition) resolves immediately;
      // any later call would be the email-side-effect follow-up.
      documentModel.updateStatus.mockResolvedValue(updatedDoc);
      documentEventModel.create.mockResolvedValue({});
      let resolveEmail;
      emailService.sendInvoiceAuthorized.mockReturnValue(new Promise((resolve) => { resolveEmail = resolve; }));

      await documentTransmission.checkAuthorization(ACCESS_KEY, mockIssuer);

      // Only the initial STATUS_CHANGED update has landed — the email promise
      // is still pending, proving the function returned without awaiting it.
      expect(documentModel.updateStatus).toHaveBeenCalledTimes(1);

      resolveEmail({ sent: true, messageId: 'msg-1' });
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    });

    test('records SENT email status and an EMAIL_SENT event once the fire-and-forget email succeeds', async () => {
      const doc = baseDoc({ status: 'RECEIVED' });
      documentModel.findByAccessKey.mockResolvedValue(doc);
      sriService.checkAuthorization.mockResolvedValue({
        pending: false, status: 'AUTORIZADO', messages: [], rawResponse: '<raw/>',
      });
      sriResponseModel.create.mockResolvedValue({});
      const updatedDoc = baseDoc({ status: 'AUTHORIZED', issuer_id: mockIssuer.id });
      documentModel.updateStatus.mockResolvedValue(updatedDoc);
      documentEventModel.create.mockResolvedValue({});
      emailService.sendInvoiceAuthorized.mockResolvedValue({ sent: true, messageId: 'msg-42' });

      await documentTransmission.checkAuthorization(ACCESS_KEY, mockIssuer);
      // Flush the microtask queue so the fire-and-forget .then() chain settles.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(documentModel.updateStatus).toHaveBeenCalledWith(
        updatedDoc.id, updatedDoc.status,
        expect.objectContaining({ email_status: 'SENT', email_message_id: 'msg-42', email_sent_at: expect.any(Date) }),
        updatedDoc.issuer_id, mockIssuer.sandbox
      );
      expect(documentEventModel.create).toHaveBeenCalledWith(
        updatedDoc.id, 'EMAIL_SENT', null, null, { to: updatedDoc.buyer_email }, null, updatedDoc.issuer_id, mockIssuer.sandbox
      );
    });

    test('records FAILED email status and an EMAIL_FAILED event when the fire-and-forget email rejects', async () => {
      const doc = baseDoc({ status: 'RECEIVED' });
      documentModel.findByAccessKey.mockResolvedValue(doc);
      sriService.checkAuthorization.mockResolvedValue({
        pending: false, status: 'AUTORIZADO', messages: [], rawResponse: '<raw/>',
      });
      sriResponseModel.create.mockResolvedValue({});
      const updatedDoc = baseDoc({ status: 'AUTHORIZED', issuer_id: mockIssuer.id });
      documentModel.updateStatus.mockResolvedValue(updatedDoc);
      documentEventModel.create.mockResolvedValue({});
      emailService.sendInvoiceAuthorized.mockRejectedValue(new Error('mailgun unreachable'));

      await documentTransmission.checkAuthorization(ACCESS_KEY, mockIssuer);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(documentModel.updateStatus).toHaveBeenCalledWith(
        updatedDoc.id, updatedDoc.status,
        expect.objectContaining({ email_status: 'FAILED', email_error: 'mailgun unreachable' }),
        updatedDoc.issuer_id, mockIssuer.sandbox
      );
      expect(documentEventModel.create).toHaveBeenCalledWith(
        updatedDoc.id, 'EMAIL_FAILED', null, null, { error: 'mailgun unreachable' }, null, updatedDoc.issuer_id, mockIssuer.sandbox
      );
    });
  });
});
