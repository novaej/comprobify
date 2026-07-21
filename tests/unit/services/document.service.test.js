jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/document-line-item.model');
jest.mock('../../../src/models/document-event.model');
jest.mock('../../../src/models/catalog.model');
jest.mock('../../../src/models/issuer-document-type.model');
jest.mock('../../../src/services/sequential.service');
jest.mock('../../../src/services/access-key.service');
jest.mock('../../../src/services/signing.service');
jest.mock('../../../src/services/xml-validator.service');
jest.mock('../../../src/services/sri.service');
jest.mock('../../../src/models/sri-response.model');
jest.mock('../../../src/services/email.service');
jest.mock('../../../src/builders');

// Mock the database module so the service can obtain a transaction client
const mockClient = {
  query: jest.fn().mockResolvedValue({}),
  release: jest.fn(),
};
jest.mock('../../../src/config/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  setIssuerContext: jest.fn().mockResolvedValue({}),
  queryAsIssuer: jest.fn(),
}));

const db = require('../../../src/config/database');
const documentModel = require('../../../src/models/document.model');
const documentLineItemModel = require('../../../src/models/document-line-item.model');
const documentEventModel = require('../../../src/models/document-event.model');
const catalogModel = require('../../../src/models/catalog.model');
const issuerDocumentTypeModel = require('../../../src/models/issuer-document-type.model');
const sequentialService = require('../../../src/services/sequential.service');
const accessKeyService = require('../../../src/services/access-key.service');
const signingService = require('../../../src/services/signing.service');
const xmlValidator = require('../../../src/services/xml-validator.service');
const builders = require('../../../src/builders');
const sriService = require('../../../src/services/sri.service');
const sriResponseModel = require('../../../src/models/sri-response.model');
const documentCreation = require('../../../src/services/document-creation.service');
const documentTransmission = require('../../../src/services/document-transmission.service');
const documentQuery = require('../../../src/services/document-query.service');

const mockIssuer = {
  id: '00000000-0000-0000-0000-000000000001',
  tenant_id: '00000000-0000-0000-0000-000000000010',
  ruc: '1712345678001',
  business_name: 'TEST COMPANY',
  trade_name: 'TEST',
  main_address: 'QUITO',
  branch_code: '001',
  issue_point_code: '001',
  environment: '1',
  emission_type: '1',
  sandbox: false,
  encrypted_private_key: 'encrypted-private-key',
  certificate_pem: '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----',
  branch_address: 'AV. TEST',
};

const validBody = {
  documentType: '01',
  issueDate: '26/02/2026',
  buyer: { idType: '04', id: '1712345678001', name: 'BUYER S.A.', address: 'ADDRESS', email: 'buyer@example.com' },
  items: [{
    mainCode: '001',
    description: 'SERVICE',
    quantity: '1.000000',
    unitPrice: '100.000000',
    discount: '0.00',
    taxes: [{ code: '2', rateCode: '2', rate: '12.00', taxBase: '100.00', value: '12.00' }],
  }],
  payments: [{ method: '20', total: '112.00' }],
};

describe('DocumentCreationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    db.getClient.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [{ id: '00000000-0000-0000-0000-000000000001' }] });

    issuerDocumentTypeModel.findActiveByIssuerId.mockResolvedValue(['01']);
    sequentialService.getNext.mockResolvedValue(263);
    accessKeyService.generate.mockResolvedValue('2602202601171234567800110010010000002630000026311');

    const mockBuilder = {
      build: jest.fn().mockReturnValue('<factura>xml</factura>'),
      subtotal: '100.00',
      total: '112.00',
    };
    builders.getBuilder.mockReturnValue(mockBuilder);
    signingService.signXml.mockReturnValue('<factura>signed-xml</factura>');
    xmlValidator.validate.mockResolvedValue({ valid: true });
    documentLineItemModel.bulkCreate.mockResolvedValue([]);
    documentEventModel.create.mockResolvedValue({});

    documentModel.create.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000001',
      access_key: '2602202601171234567800110010010000002630000026311',
      sequential: 263,
      status: 'SIGNED',
      issue_date: new Date('2026-02-26'),
      total: '112.00',
    });
    documentModel.findByIdempotencyKey.mockResolvedValue(null);
  });

  test('create calls services in correct order and saves document', async () => {
    const { document, created } = await documentCreation.create(validBody, null, mockIssuer);

    // issuer is now passed in — no DB lookup
    expect(sequentialService.getNext).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', '001', '001', '01', mockClient);
    expect(accessKeyService.generate).toHaveBeenCalled();
    expect(builders.getBuilder).toHaveBeenCalledWith('01', mockIssuer);
    expect(signingService.signXml).toHaveBeenCalledWith(
      '<factura>xml</factura>',
      'encrypted-private-key',
      '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----'
    );
    expect(documentModel.create).toHaveBeenCalled();
    expect(created).toBe(true);
    expect(document.status).toBe('SIGNED');
    expect(document.accessKey).toBeDefined();
    expect(document.sequential).toBe('000000263');
  });

  test('create commits the transaction on success', async () => {
    await documentCreation.create(validBody, null, mockIssuer);
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('create rolls back the transaction and releases client on error', async () => {
    xmlValidator.validate.mockResolvedValue({
      valid: false,
      errors: [{ message: 'Element infoFactura is not valid' }],
    });
    await expect(documentCreation.create(validBody, null, mockIssuer)).rejects.toMatchObject({ statusCode: 400 });
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('create throws ValidationError when XSD validation fails', async () => {
    xmlValidator.validate.mockResolvedValue({
      valid: false,
      errors: [{ message: 'Element infoFactura is not valid' }],
    });
    await expect(documentCreation.create(validBody, null, mockIssuer)).rejects.toMatchObject({
      statusCode: 400,
      errors: [{ message: 'Element infoFactura is not valid' }],
    });
  });

  test('create persists invoice_details and logs CREATED event', async () => {
    await documentCreation.create(validBody, null, mockIssuer);
    expect(documentLineItemModel.bulkCreate).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', validBody.items, mockClient);
    expect(documentEventModel.create).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001', 'CREATED', null, 'SIGNED', expect.any(Object), mockClient
    );
  });

  describe('Idempotency', () => {
    const IDEM_KEY = 'order-abc-123';
    const crypto = require('crypto');
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(validBody)).digest('hex');

    const existingDoc = {
      id: '00000000-0000-0000-0000-000000000099',
      access_key: '2602202601171234567800110010010000002630000026311',
      sequential: 263,
      status: 'SIGNED',
      issue_date: new Date('2026-02-26'),
      total: '112.00',
      idempotency_key: IDEM_KEY,
      payload_hash: payloadHash,
    };

    test('returns existing document with created=false when key and payload match', async () => {
      documentModel.findByIdempotencyKey.mockResolvedValue(existingDoc);

      const result = await documentCreation.create(validBody, IDEM_KEY, mockIssuer);

      expect(result.created).toBe(false);
      expect(result.document.accessKey).toBe(existingDoc.access_key);
      expect(documentModel.create).not.toHaveBeenCalled();
      expect(sequentialService.getNext).not.toHaveBeenCalled();
    });

    test('throws ConflictError when key exists but payload differs', async () => {
      documentModel.findByIdempotencyKey.mockResolvedValue({
        ...existingDoc,
        payload_hash: 'completely-different-hash',
      });

      await expect(documentCreation.create(validBody, IDEM_KEY, mockIssuer))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    test('creates new document with created=true when no idempotency key provided', async () => {
      const result = await documentCreation.create(validBody, null, mockIssuer);

      expect(result.created).toBe(true);
      expect(documentModel.findByIdempotencyKey).not.toHaveBeenCalled();
      expect(documentModel.create).toHaveBeenCalled();
    });

    test('creates new document with created=true when key is new', async () => {
      const result = await documentCreation.create(validBody, IDEM_KEY, mockIssuer);

      expect(result.created).toBe(true);
      expect(documentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: IDEM_KEY }),
        mockClient
      );
    });
  });
});

describe('DocumentQueryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getByAccessKey returns formatted document', async () => {
    documentModel.findByAccessKey.mockResolvedValue({
      access_key: '2602202601171234567800110010010000002630000026311',
      sequential: 263,
      status: 'SIGNED',
      issue_date: new Date('2026-02-26'),
      total: '112.00',
    });

    const result = await documentQuery.getByAccessKey('2602202601171234567800110010010000002630000026311', mockIssuer);
    expect(result.accessKey).toBe('2602202601171234567800110010010000002630000026311');
    expect(result.status).toBe('SIGNED');
    expect(documentModel.findByAccessKey).toHaveBeenCalledWith(
      '2602202601171234567800110010010000002630000026311', mockIssuer.id, mockIssuer.sandbox
    );
  });

  test('getByAccessKey returns null for unknown key', async () => {
    documentModel.findByAccessKey.mockResolvedValue(null);
    const result = await documentQuery.getByAccessKey('0000000000000000000000000000000000000000000000000', mockIssuer);
    expect(result).toBeNull();
  });

  test('getStats maps document type codes to labels and formats totals', async () => {
    documentModel.getStats.mockResolvedValue({
      byType: [
        { document_type: '01', issued: '5', authorized_total: '1800' },
        { document_type: '06', issued: '2', authorized_total: '0' },
      ],
      needsAttention: 3,
    });
    catalogModel.getDocumentTypeLabel.mockImplementation((code) => Promise.resolve({ '01': 'FAC', '06': 'REM' }[code]));

    const result = await documentQuery.getStats(mockIssuer);

    expect(documentModel.getStats).toHaveBeenCalledWith(mockIssuer.id, mockIssuer.sandbox);
    expect(result).toEqual({
      thisMonth: {
        byType: [
          { type: 'FAC', issued: 5, authorizedTotal: '1800.00' },
          { type: 'REM', issued: 2, authorizedTotal: '0.00' },
        ],
      },
      needsAttention: 3,
    });
  });

  test('getStats returns an empty byType array when no documents were issued this month', async () => {
    documentModel.getStats.mockResolvedValue({ byType: [], needsAttention: 0 });

    const result = await documentQuery.getStats(mockIssuer);

    expect(result).toEqual({ thisMonth: { byType: [] }, needsAttention: 0 });
  });

  describe('getCreditNotes', () => {
    test('throws NotFoundError when the original document does not exist', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);

      await expect(documentQuery.getCreditNotes('0'.repeat(49), mockIssuer)).rejects.toThrow('Document not found');
    });

    test('reconstructs the originalDocument number from issuer branch/issue point + padded sequential', async () => {
      documentModel.findByAccessKey.mockResolvedValue({
        access_key: 'orig-key', document_type: '01', sequential: 27, total: '115.00',
      });
      documentModel.findCreditNotesByOriginalDocument.mockResolvedValue([]);

      await documentQuery.getCreditNotes('orig-key', mockIssuer);

      expect(documentModel.findCreditNotesByOriginalDocument).toHaveBeenCalledWith(
        mockIssuer.id, '01', '001-001-000000027', mockIssuer.sandbox
      );
    });

    test('sums credit note totals and computes remaining balance', async () => {
      documentModel.findByAccessKey.mockResolvedValue({
        access_key: 'orig-key', document_type: '01', sequential: 27, total: '115.00',
      });
      documentModel.findCreditNotesByOriginalDocument.mockResolvedValue([
        { access_key: 'cn-1', sequential: 12, total: '30.00', issue_date: new Date('2026-04-01T12:00:00Z') },
        { access_key: 'cn-2', sequential: 13, total: '5.00', issue_date: new Date('2026-04-02T12:00:00Z') },
      ]);

      const result = await documentQuery.getCreditNotes('orig-key', mockIssuer);

      expect(result.originalDocument).toEqual({ accessKey: 'orig-key', total: '115.00' });
      expect(result.creditedTotal).toBe('35.00');
      expect(result.remaining).toBe('80.00');
      expect(result.creditNotes).toEqual([
        { accessKey: 'cn-1', sequential: '000000012', total: '30.00', issueDate: '01/04/2026' },
        { accessKey: 'cn-2', sequential: '000000013', total: '5.00', issueDate: '02/04/2026' },
      ]);
    });

    test('returns "0.00" credited and full remaining when no credit notes exist', async () => {
      documentModel.findByAccessKey.mockResolvedValue({
        access_key: 'orig-key', document_type: '01', sequential: 27, total: '115.00',
      });
      documentModel.findCreditNotesByOriginalDocument.mockResolvedValue([]);

      const result = await documentQuery.getCreditNotes('orig-key', mockIssuer);

      expect(result.creditedTotal).toBe('0.00');
      expect(result.remaining).toBe('115.00');
      expect(result.creditNotes).toEqual([]);
    });

    test('does not hardcode the original document type — passes through whatever type it is', async () => {
      documentModel.findByAccessKey.mockResolvedValue({
        access_key: 'orig-key', document_type: '03', sequential: 5, total: '50.00',
      });
      documentModel.findCreditNotesByOriginalDocument.mockResolvedValue([]);

      await documentQuery.getCreditNotes('orig-key', mockIssuer);

      expect(documentModel.findCreditNotesByOriginalDocument).toHaveBeenCalledWith(
        mockIssuer.id, '03', expect.any(String), mockIssuer.sandbox
      );
    });
  });
});

describe('DocumentTransmissionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sendToSri rejects when status is not PENDING_SEND', async () => {
    documentModel.findByAccessKey.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000001',
      status: 'AUTHORIZED',
      signed_xml: '<xml/>',
    });

    await expect(documentTransmission.sendToSri('1234567890123456789012345678901234567890123456789', mockIssuer))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('sends and sets RECEIVED when SRI returns code 70', async () => {
    // sendToSri is only ever called (by the worker) on a PENDING_SEND
    // document now — SIGNED -> RECEIVED is no longer a valid direct
    // transition since the send/authorize pipeline went async-only.
    const doc = { id: '00000000-0000-0000-0000-000000000001', status: 'PENDING_SEND', signed_xml: '<xml/>' };
    documentModel.findByAccessKey.mockResolvedValue(doc);
    sriService.sendReceipt.mockResolvedValue({
      status: 'DEVUELTA',
      messages: [{ identifier: '70', message: 'CLAVE DE ACCESO EN PROCESAMIENTO' }],
      rawResponse: '<raw/>',
    });
    sriResponseModel.create.mockResolvedValue({});
    documentModel.updateStatus.mockResolvedValue({ ...doc, status: 'RECEIVED' });
    documentEventModel.create.mockResolvedValue({});

    const result = await documentTransmission.sendToSri('1234567890123456789012345678901234567890123456789', mockIssuer);

    expect(documentModel.updateStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'RECEIVED', {}, mockIssuer.id, mockIssuer.sandbox);
    expect(documentEventModel.create).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001', 'SENT', 'PENDING_SEND', 'RECEIVED',
      expect.objectContaining({ processingRetry: true, sriIdentifier: '70' }),
      null, mockIssuer.id, mockIssuer.sandbox
    );
    expect(result.status).toBe('RECEIVED');
    expect(result.sriStatus).toBe('DEVUELTA');
    expect(result.processingRetry).toBe(true);
    expect(result.sriMessages).toEqual([{ identifier: '70', message: 'CLAVE DE ACCESO EN PROCESAMIENTO' }]);
  });

  test('sends and sets RETURNED for non-70 DEVUELTA', async () => {
    const doc = { id: '00000000-0000-0000-0000-000000000001', status: 'PENDING_SEND', signed_xml: '<xml/>' };
    documentModel.findByAccessKey.mockResolvedValue(doc);
    const messages = [{ identifier: '43', message: 'SOME OTHER ERROR' }];
    sriService.sendReceipt.mockResolvedValue({
      status: 'DEVUELTA',
      messages,
      rawResponse: '<raw/>',
    });
    sriResponseModel.create.mockResolvedValue({});
    documentModel.updateStatus.mockResolvedValue({ ...doc, status: 'RETURNED' });
    documentEventModel.create.mockResolvedValue({});

    const result = await documentTransmission.sendToSri('1234567890123456789012345678901234567890123456789', mockIssuer);

    expect(documentModel.updateStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'RETURNED', {}, mockIssuer.id, mockIssuer.sandbox);
    expect(documentEventModel.create).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001', 'SENT', 'PENDING_SEND', 'RETURNED',
      { sriStatus: 'DEVUELTA' },
      null, mockIssuer.id, mockIssuer.sandbox
    );
    expect(result.status).toBe('RETURNED');
    expect(result.sriStatus).toBe('DEVUELTA');
    expect(result.processingRetry).toBeUndefined();
    expect(result.sriMessages).toEqual(messages);
  });

  test('checkAuthorization rejects when status is not RECEIVED', async () => {
    documentModel.findByAccessKey.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000001',
      status: 'SIGNED',
    });

    await expect(documentTransmission.checkAuthorization('1234567890123456789012345678901234567890123456789', mockIssuer))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
