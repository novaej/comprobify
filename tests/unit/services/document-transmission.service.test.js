jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/document-event.model');
jest.mock('../../../src/services/sri.service');
jest.mock('../../../src/models/sri-response.model');
jest.mock('../../../src/services/pending-effect.service');

const documentModel = require('../../../src/models/document.model');
const documentEventModel = require('../../../src/models/document-event.model');
const sriService = require('../../../src/services/sri.service');
const sriResponseModel = require('../../../src/models/sri-response.model');
const pendingEffectService = require('../../../src/services/pending-effect.service');
const documentTransmission = require('../../../src/services/document-transmission.service');

const ACCESS_KEY = '1234567890123456789012345678901234567890123456789';

const mockIssuer = { id: '00000000-0000-0000-0000-000000000001', tenant_id: '00000000-0000-0000-0000-000000000900', sandbox: false };

function baseDoc(overrides = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
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
    beforeEach(() => {
      pendingEffectService.enqueue.mockResolvedValue({ id: 'effect-1', effect_type: 'SRI_AUTHORIZE' });
    });

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
      // sendToSri is only ever called (by the SRI_SEND effect handler) on a
      // PENDING_SEND document — SIGNED -> RECEIVED/RETURNED is no longer a
      // valid direct transition since the send/authorize pipeline went
      // async-only.
      const doc = baseDoc({ status: 'PENDING_SEND' });
      documentModel.findByAccessKey.mockResolvedValue(doc);
      const sriErr = new Error('network down');
      sriService.sendReceipt.mockRejectedValue(sriErr);

      await expect(documentTransmission.sendToSri(ACCESS_KEY, mockIssuer)).rejects.toThrow('network down');

      expect(documentEventModel.create).toHaveBeenCalledWith(
        doc.id, 'ERROR', 'PENDING_SEND', null,
        { operation: 'SEND', message: 'network down' },
        null, mockIssuer.id, mockIssuer.sandbox
      );
      expect(documentModel.updateStatus).not.toHaveBeenCalled();
      expect(pendingEffectService.enqueue).not.toHaveBeenCalled();
    });

    test('sets RECEIVED when SRI returns RECIBIDA and durably enqueues (but does not dispatch) SRI_AUTHORIZE', async () => {
      const doc = baseDoc({ status: 'PENDING_SEND' });
      documentModel.findByAccessKey.mockResolvedValue(doc);
      sriService.sendReceipt.mockResolvedValue({ status: 'RECIBIDA', messages: [], rawResponse: '<raw/>' });
      sriResponseModel.create.mockResolvedValue({});
      const receivedDoc = baseDoc({ status: 'RECEIVED' });
      documentModel.updateStatus.mockResolvedValue(receivedDoc);
      documentEventModel.create.mockResolvedValue({});

      const result = await documentTransmission.sendToSri(ACCESS_KEY, mockIssuer);

      expect(sriResponseModel.create).toHaveBeenCalledWith(expect.objectContaining({
        documentId: doc.id, operationType: 'RECEPTION', status: 'RECIBIDA', sandbox: mockIssuer.sandbox,
      }));
      expect(documentModel.updateStatus).toHaveBeenCalledWith(doc.id, 'RECEIVED', {}, mockIssuer.id, mockIssuer.sandbox);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        doc.id, 'SENT', 'PENDING_SEND', 'RECEIVED', { sriStatus: 'RECIBIDA' }, null, mockIssuer.id, mockIssuer.sandbox
      );
      // Becoming RECEIVED guarantees an SRI_AUTHORIZE effect exists even if
      // the client never calls GET /:key/authorize — but it's enqueued
      // only, never dispatched here (see ADR-022: the first dispatch is
      // left to reconciliation's authorizeCheckDelayMinutes window, or to
      // queueAuthorizationCheck if the client asks explicitly).
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith(
        'SRI_AUTHORIZE',
        mockIssuer.tenant_id,
        { documentId: receivedDoc.id, accessKey: receivedDoc.access_key, issuerId: mockIssuer.id, sandbox: mockIssuer.sandbox },
        `sri-authorize:${receivedDoc.id}`
      );
      expect(pendingEffectService.dispatch).not.toHaveBeenCalled();
      expect(result.status).toBe('RECEIVED');
      expect(result.sriStatus).toBe('RECIBIDA');
      expect(result.processingRetry).toBeUndefined();
    });

    test('sets RECEIVED (with processingRetry) when SRI returns DEVUELTA with identifier 70', async () => {
      const doc = baseDoc({ status: 'PENDING_SEND' });
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
        doc.id, 'SENT', 'PENDING_SEND', 'RECEIVED',
        expect.objectContaining({ processingRetry: true, sriIdentifier: '70' }),
        null, mockIssuer.id, mockIssuer.sandbox
      );
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith('SRI_AUTHORIZE', mockIssuer.tenant_id, expect.any(Object), expect.any(String));
      expect(result.processingRetry).toBe(true);
    });

    test('sets RETURNED for a non-70 DEVUELTA response and does not enqueue SRI_AUTHORIZE', async () => {
      const doc = baseDoc({ status: 'PENDING_SEND' });
      documentModel.findByAccessKey.mockResolvedValue(doc);
      const messages = [{ identifier: '43', message: 'SOME OTHER ERROR' }];
      sriService.sendReceipt.mockResolvedValue({ status: 'DEVUELTA', messages, rawResponse: '<raw/>' });
      sriResponseModel.create.mockResolvedValue({});
      documentModel.updateStatus.mockResolvedValue(baseDoc({ status: 'RETURNED' }));
      documentEventModel.create.mockResolvedValue({});

      const result = await documentTransmission.sendToSri(ACCESS_KEY, mockIssuer);

      expect(documentModel.updateStatus).toHaveBeenCalledWith(doc.id, 'RETURNED', {}, mockIssuer.id, mockIssuer.sandbox);
      expect(pendingEffectService.enqueue).not.toHaveBeenCalled();
      expect(result.status).toBe('RETURNED');
      expect(result.processingRetry).toBeUndefined();
      expect(result.sriMessages).toEqual(messages);
    });
  });

  describe('checkAuthorization', () => {
    beforeEach(() => {
      pendingEffectService.enqueue.mockResolvedValue({ id: 'effect-x', effect_type: 'X' });
      pendingEffectService.dispatch.mockResolvedValue();
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

    test('returns { requeue: true } (no update, no event, no effects) when SRI reports pending', async () => {
      const doc = baseDoc({ status: 'RECEIVED' });
      documentModel.findByAccessKey.mockResolvedValue(doc);
      sriService.checkAuthorization.mockResolvedValue({ pending: true, status: null, messages: [], rawResponse: '<raw/>' });
      sriResponseModel.create.mockResolvedValue({});

      const result = await documentTransmission.checkAuthorization(ACCESS_KEY, mockIssuer);

      expect(documentModel.updateStatus).not.toHaveBeenCalled();
      expect(documentEventModel.create).not.toHaveBeenCalled();
      expect(pendingEffectService.enqueue).not.toHaveBeenCalled();
      expect(result).toEqual({ requeue: true });
    });

    test('sets NOT_AUTHORIZED and does not enqueue any post-authorization effect', async () => {
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
      expect(pendingEffectService.enqueue).not.toHaveBeenCalled();
    });

    test('sets AUTHORIZED, stores authorization fields, and durably enqueues every post-authorization effect', async () => {
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

      // The INSERT (enqueue) for every effect must be awaited before
      // checkAuthorization returns — a crash right after must not lose any
      // of these (see ADR-022). Dispatch (the RabbitMQ publish) stays
      // best-effort/unawaited, same as document-transmission's other
      // producer call sites.
      // No SUBSCRIPTION_* effects — that reconciliation moved to a periodic
      // scan in POST /v1/admin/jobs/subscriptions (see ADR-022's addendum),
      // not a RabbitMQ effect fired on every document authorization.
      const expectedPayload = {
        documentId: updatedDoc.id, accessKey: updatedDoc.access_key, issuerId: mockIssuer.id, sandbox: mockIssuer.sandbox,
      };
      for (const type of [
        'DOCUMENT_AUTHORIZED_NOTIFICATION',
        'INVOICE_AUTHORIZED_EMAIL',
      ]) {
        expect(pendingEffectService.enqueue).toHaveBeenCalledWith(type, mockIssuer.tenant_id, expectedPayload, null);
      }
      expect(pendingEffectService.enqueue).toHaveBeenCalledTimes(2);
      expect(pendingEffectService.dispatch).toHaveBeenCalledTimes(2);
    });
  });

  describe('queueSend', () => {
    test('throws NotFoundError when the document does not exist', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);

      await expect(documentTransmission.queueSend(ACCESS_KEY, mockIssuer))
        .rejects.toMatchObject({ statusCode: 404 });
      expect(pendingEffectService.enqueue).not.toHaveBeenCalled();
    });

    test('throws on an invalid state transition (e.g. already PENDING_SEND)', async () => {
      documentModel.findByAccessKey.mockResolvedValue(baseDoc({ status: 'PENDING_SEND' }));

      await expect(documentTransmission.queueSend(ACCESS_KEY, mockIssuer))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_STATE_TRANSITION' });
      expect(pendingEffectService.enqueue).not.toHaveBeenCalled();
    });

    test('moves SIGNED -> PENDING_SEND, durably enqueues, and best-effort dispatches an SRI_SEND effect', async () => {
      const doc = baseDoc({ status: 'SIGNED' });
      documentModel.findByAccessKey.mockResolvedValue(doc);
      const pendingDoc = baseDoc({ status: 'PENDING_SEND' });
      documentModel.updateStatus.mockResolvedValue(pendingDoc);
      documentEventModel.create.mockResolvedValue({});
      const effectRow = { id: 'effect-send-1', effect_type: 'SRI_SEND' };
      pendingEffectService.enqueue.mockResolvedValue(effectRow);

      const result = await documentTransmission.queueSend(ACCESS_KEY, mockIssuer);

      expect(documentModel.updateStatus).toHaveBeenCalledWith(doc.id, 'PENDING_SEND', {}, mockIssuer.id, mockIssuer.sandbox);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        doc.id, 'STATUS_CHANGED', 'SIGNED', 'PENDING_SEND', {}, null, mockIssuer.id, mockIssuer.sandbox
      );
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith('SRI_SEND', mockIssuer.tenant_id, {
        documentId: pendingDoc.id, accessKey: pendingDoc.access_key, issuerId: mockIssuer.id, sandbox: mockIssuer.sandbox,
      }, null);
      expect(pendingEffectService.dispatch).toHaveBeenCalledWith(effectRow);
      expect(result.status).toBe('PENDING_SEND');
    });
  });

  describe('queueAuthorizationCheck', () => {
    test('throws NotFoundError when the document does not exist', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);

      await expect(documentTransmission.queueAuthorizationCheck(ACCESS_KEY, mockIssuer))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    test('throws on an invalid state transition (e.g. still SIGNED)', async () => {
      documentModel.findByAccessKey.mockResolvedValue(baseDoc({ status: 'SIGNED' }));

      await expect(documentTransmission.queueAuthorizationCheck(ACCESS_KEY, mockIssuer))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_STATE_TRANSITION' });
      expect(pendingEffectService.enqueue).not.toHaveBeenCalled();
    });

    test('finds-or-creates the SRI_AUTHORIZE row via dedup_key and dispatches it immediately, without changing status', async () => {
      const doc = baseDoc({ status: 'RECEIVED' });
      documentModel.findByAccessKey.mockResolvedValue(doc);
      const effectRow = { id: 'effect-auth-1', effect_type: 'SRI_AUTHORIZE' };
      pendingEffectService.enqueue.mockResolvedValue(effectRow);

      const result = await documentTransmission.queueAuthorizationCheck(ACCESS_KEY, mockIssuer);

      expect(pendingEffectService.enqueue).toHaveBeenCalledWith(
        'SRI_AUTHORIZE',
        mockIssuer.tenant_id,
        { documentId: doc.id, accessKey: doc.access_key, issuerId: mockIssuer.id, sandbox: mockIssuer.sandbox },
        `sri-authorize:${doc.id}`
      );
      expect(pendingEffectService.dispatch).toHaveBeenCalledWith(effectRow);
      expect(documentModel.updateStatus).not.toHaveBeenCalled();
      expect(result.status).toBe('RECEIVED');
    });
  });
});
