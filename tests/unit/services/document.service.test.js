jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/document-line-item.model');
jest.mock('../../../src/models/document-event.model');
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
  id: 1,
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
    mockClient.query.mockResolvedValue({});

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
      id: 1,
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
    expect(sequentialService.getNext).toHaveBeenCalledWith(1, '001', '001', '01', mockClient);
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
    expect(documentLineItemModel.bulkCreate).toHaveBeenCalledWith(1, validBody.items, mockClient);
    expect(documentEventModel.create).toHaveBeenCalledWith(
      1, 'CREATED', null, 'SIGNED', expect.any(Object), mockClient
    );
  });

  describe('Idempotency', () => {
    const IDEM_KEY = 'order-abc-123';
    const crypto = require('crypto');
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(validBody)).digest('hex');

    const existingDoc = {
      id: 99,
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
});

describe('DocumentTransmissionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sendToSri rejects when status is not SIGNED', async () => {
    documentModel.findByAccessKey.mockResolvedValue({
      id: 1,
      status: 'AUTHORIZED',
      signed_xml: '<xml/>',
    });

    await expect(documentTransmission.sendToSri('1234567890123456789012345678901234567890123456789', mockIssuer))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('sends and sets RECEIVED when SRI returns code 70', async () => {
    const doc = { id: 1, status: 'SIGNED', signed_xml: '<xml/>' };
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

    expect(documentModel.updateStatus).toHaveBeenCalledWith(1, 'RECEIVED', {}, mockIssuer.id, mockIssuer.sandbox);
    expect(documentEventModel.create).toHaveBeenCalledWith(
      1, 'SENT', 'SIGNED', 'RECEIVED',
      expect.objectContaining({ processingRetry: true, sriIdentifier: '70' }),
      null, mockIssuer.id, mockIssuer.sandbox
    );
    expect(result.status).toBe('RECEIVED');
    expect(result.sriStatus).toBe('DEVUELTA');
    expect(result.processingRetry).toBe(true);
    expect(result.sriMessages).toEqual([{ identifier: '70', message: 'CLAVE DE ACCESO EN PROCESAMIENTO' }]);
  });

  test('sends and sets RETURNED for non-70 DEVUELTA', async () => {
    const doc = { id: 1, status: 'SIGNED', signed_xml: '<xml/>' };
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

    expect(documentModel.updateStatus).toHaveBeenCalledWith(1, 'RETURNED', {}, mockIssuer.id, mockIssuer.sandbox);
    expect(documentEventModel.create).toHaveBeenCalledWith(
      1, 'SENT', 'SIGNED', 'RETURNED',
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
      id: 1,
      status: 'SIGNED',
    });

    await expect(documentTransmission.checkAuthorization('1234567890123456789012345678901234567890123456789', mockIssuer))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
