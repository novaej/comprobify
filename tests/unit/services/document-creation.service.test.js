jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/document-line-item.model');
jest.mock('../../../src/models/document-event.model');
jest.mock('../../../src/models/issuer-document-type.model');
jest.mock('../../../src/services/sequential.service');
jest.mock('../../../src/services/access-key.service');
jest.mock('../../../src/services/signing.service');
jest.mock('../../../src/services/xml-validator.service');
jest.mock('../../../src/builders');
// Mocked so ambiente logic can be exercised for both staging and production
// without depending on the actual APP_ENV of the test runner.
jest.mock('../../../src/config', () => ({ appEnv: 'production' }));

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};
jest.mock('../../../src/config/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  setIssuerContext: jest.fn().mockResolvedValue({}),
  queryAsIssuer: jest.fn(),
}));

const crypto = require('crypto');
const db = require('../../../src/config/database');
const config = require('../../../src/config');
const documentModel = require('../../../src/models/document.model');
const documentLineItemModel = require('../../../src/models/document-line-item.model');
const documentEventModel = require('../../../src/models/document-event.model');
const issuerDocumentTypeModel = require('../../../src/models/issuer-document-type.model');
const sequentialService = require('../../../src/services/sequential.service');
const accessKeyService = require('../../../src/services/access-key.service');
const signingService = require('../../../src/services/signing.service');
const xmlValidator = require('../../../src/services/xml-validator.service');
const builders = require('../../../src/builders');
const documentCreationService = require('../../../src/services/document-creation.service');

const prodIssuer = {
  id: 1,
  tenant_id: 10,
  ruc: '1712345678001',
  business_name: 'ACME S.A.',
  branch_code: '001',
  issue_point_code: '001',
  emission_type: '1',
  sandbox: false,
  encrypted_private_key: 'encrypted-private-key',
  certificate_pem: '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----',
};

const sandboxIssuer = { ...prodIssuer, sandbox: true };

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

const accessKey = '2602202601171234567800110010010000002630000026311';

function makeCreatedDocument(overrides = {}) {
  return {
    id: 1,
    access_key: accessKey,
    sequential: 263,
    document_type: '01',
    status: 'SIGNED',
    issue_date: new Date('2026-02-26'),
    total: '112.00',
    buyer_id: '1712345678001',
    buyer_name: 'BUYER S.A.',
    buyer_id_type: '04',
    buyer_email: 'buyer@example.com',
    ...overrides,
  };
}

describe('DocumentCreationService', () => {
  let mockBuilder;

  beforeEach(() => {
    jest.clearAllMocks();
    config.appEnv = 'production';

    db.getClient.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [{ id: 1 }] });

    issuerDocumentTypeModel.findActiveByIssuerId.mockResolvedValue(['01']);
    sequentialService.getNext.mockResolvedValue(263);
    accessKeyService.generate.mockResolvedValue(accessKey);

    mockBuilder = {
      build: jest.fn().mockReturnValue('<factura>xml</factura>'),
      subtotal: '100.00',
      total: '112.00',
    };
    builders.getBuilder.mockReturnValue(mockBuilder);
    signingService.signXml.mockReturnValue('<factura>signed-xml</factura>');
    xmlValidator.validate.mockResolvedValue({ valid: true });
    documentLineItemModel.bulkCreate.mockResolvedValue([]);
    documentEventModel.create.mockResolvedValue({});

    documentModel.create.mockResolvedValue(makeCreatedDocument());
    documentModel.findByIdempotencyKey.mockResolvedValue(null);
  });

  describe('create — happy path', () => {
    test('runs the pipeline in order and returns created:true with the formatted document', async () => {
      const { document, created } = await documentCreationService.create(validBody, null, prodIssuer);

      expect(issuerDocumentTypeModel.findActiveByIssuerId).toHaveBeenCalledWith(1);
      expect(sequentialService.getNext).toHaveBeenCalledWith(1, '001', '001', '01', mockClient);
      expect(accessKeyService.generate).toHaveBeenCalled();
      expect(builders.getBuilder).toHaveBeenCalledWith('01', expect.objectContaining({ id: 1, environment: '2' }));
      expect(mockBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({ issueDate: '26/02/2026' }),
        accessKey,
        263
      );
      expect(xmlValidator.validate).toHaveBeenCalledWith('<factura>xml</factura>', '01');
      expect(signingService.signXml).toHaveBeenCalledWith(
        '<factura>xml</factura>',
        'encrypted-private-key',
        '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----'
      );
      expect(documentModel.create).toHaveBeenCalled();
      expect(created).toBe(true);
      expect(document.status).toBe('SIGNED');
      expect(document.accessKey).toBe(accessKey);
      expect(document.sequential).toBe('000000263');
    });

    test('commits the transaction and releases the client', async () => {
      await documentCreationService.create(validBody, null, prodIssuer);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('sets the issuer RLS context on the transaction client', async () => {
      await documentCreationService.create(validBody, null, prodIssuer);

      expect(db.setIssuerContext).toHaveBeenCalledWith(mockClient, prodIssuer.id, prodIssuer.sandbox);
    });

    test('persists line items and logs a CREATED audit event within the same transaction', async () => {
      await documentCreationService.create(validBody, null, prodIssuer);

      expect(documentLineItemModel.bulkCreate).toHaveBeenCalledWith(1, validBody.items, mockClient);
      expect(documentEventModel.create).toHaveBeenCalledWith(
        1, 'CREATED', null, 'SIGNED', { accessKey, sequential: 263 }, mockClient
      );
    });

    test('reads buyer.email from the payload when present', async () => {
      await documentCreationService.create(validBody, null, prodIssuer);

      expect(documentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ buyerEmail: 'buyer@example.com' }),
        mockClient
      );
    });

    test('falls back to the additionalInfo "email" field when buyer.email is absent (case-insensitive)', async () => {
      const body = {
        ...validBody,
        buyer: { ...validBody.buyer, email: undefined },
        additionalInfo: [{ name: 'Email', value: 'fallback@example.com' }],
      };

      await documentCreationService.create(body, null, prodIssuer);

      expect(documentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ buyerEmail: 'fallback@example.com' }),
        mockClient
      );
    });

    test('stores buyerEmail as null when neither buyer.email nor additionalInfo carry one', async () => {
      const body = { ...validBody, buyer: { ...validBody.buyer, email: undefined } };

      await documentCreationService.create(body, null, prodIssuer);

      expect(documentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ buyerEmail: null }),
        mockClient
      );
    });

    test('skips the payments-total cross-check when the payload has no payments block (e.g. credit notes)', async () => {
      const body = { ...validBody };
      delete body.payments;

      await expect(documentCreationService.create(body, null, prodIssuer)).resolves.toMatchObject({ created: true });
    });
  });

  describe('create — ambiente derivation', () => {
    test('embeds ambiente "2" when appEnv is production and the issuer is not sandboxed', async () => {
      config.appEnv = 'production';

      await documentCreationService.create(validBody, null, prodIssuer);

      expect(accessKeyService.generate).toHaveBeenCalledWith(expect.objectContaining({ environment: '2' }));
      expect(builders.getBuilder).toHaveBeenCalledWith('01', expect.objectContaining({ environment: '2' }));
    });

    test('embeds ambiente "1" when appEnv is production but the issuer is sandboxed', async () => {
      config.appEnv = 'production';
      issuerDocumentTypeModel.findActiveByIssuerId.mockResolvedValue(['01']);

      await documentCreationService.create(validBody, null, sandboxIssuer);

      expect(accessKeyService.generate).toHaveBeenCalledWith(expect.objectContaining({ environment: '1' }));
      expect(builders.getBuilder).toHaveBeenCalledWith('01', expect.objectContaining({ environment: '1' }));
    });

    test('embeds ambiente "1" when appEnv is staging regardless of issuer.sandbox', async () => {
      config.appEnv = 'staging';

      await documentCreationService.create(validBody, null, prodIssuer);

      expect(accessKeyService.generate).toHaveBeenCalledWith(expect.objectContaining({ environment: '1' }));
      expect(builders.getBuilder).toHaveBeenCalledWith('01', expect.objectContaining({ environment: '1' }));
    });
  });

  describe('create — document type gating', () => {
    test('throws when the document type is not enabled for the issuer, without opening a transaction', async () => {
      issuerDocumentTypeModel.findActiveByIssuerId.mockResolvedValue(['04']);

      await expect(documentCreationService.create(validBody, null, prodIssuer)).rejects.toMatchObject({
        statusCode: 400,
        code: 'DOCUMENT_TYPE_NOT_ENABLED',
      });
      expect(db.getClient).not.toHaveBeenCalled();
      expect(sequentialService.getNext).not.toHaveBeenCalled();
    });
  });

  describe('create — quota enforcement', () => {
    test('atomically increments document_count for a production issuer', async () => {
      await documentCreationService.create(validBody, null, prodIssuer);

      const quotaCall = mockClient.query.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('UPDATE tenants')
      );
      expect(quotaCall).toBeDefined();
      expect(quotaCall[1]).toEqual([prodIssuer.tenant_id]);
    });

    test('throws QuotaExceededError and rolls back when the tenant has no quota left', async () => {
      mockClient.query.mockImplementation(async (sql) => {
        if (typeof sql === 'string' && sql.includes('UPDATE tenants')) {
          return { rows: [] };
        }
        return { rows: [{ id: 1 }] };
      });

      await expect(documentCreationService.create(validBody, null, prodIssuer)).rejects.toMatchObject({
        statusCode: 402,
        code: 'QUOTA_EXCEEDED',
      });
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
      expect(documentModel.create).not.toHaveBeenCalled();
    });

    test('skips the quota check entirely for a sandbox issuer', async () => {
      await documentCreationService.create(validBody, null, sandboxIssuer);

      const quotaCall = mockClient.query.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('UPDATE tenants')
      );
      expect(quotaCall).toBeUndefined();
    });
  });

  describe('create — payments total cross-check', () => {
    test('throws ValidationError when the payments sum does not match the invoice total', async () => {
      const body = { ...validBody, payments: [{ method: '20', total: '100.00' }] };

      await expect(documentCreationService.create(body, null, prodIssuer)).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
      });
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('create — XSD validation', () => {
    test('throws ValidationError carrying the xmllint errors and rolls back', async () => {
      xmlValidator.validate.mockResolvedValue({
        valid: false,
        errors: [{ message: 'Element infoFactura is not valid' }],
      });

      await expect(documentCreationService.create(validBody, null, prodIssuer)).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        errors: [{ message: 'Element infoFactura is not valid' }],
      });
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
      expect(signingService.signXml).not.toHaveBeenCalled();
    });
  });

  describe('create — idempotency (ADR-006)', () => {
    const IDEM_KEY = 'order-abc-123';
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(validBody)).digest('hex');

    const existingDoc = makeCreatedDocument({
      id: 99,
      idempotency_key: IDEM_KEY,
      payload_hash: payloadHash,
    });

    test('returns the existing document with created:false when the key and payload hash match, without touching the sequential', async () => {
      documentModel.findByIdempotencyKey.mockResolvedValue(existingDoc);

      const result = await documentCreationService.create(validBody, IDEM_KEY, prodIssuer);

      expect(documentModel.findByIdempotencyKey).toHaveBeenCalledWith(IDEM_KEY, prodIssuer.id, prodIssuer.sandbox);
      expect(result.created).toBe(false);
      expect(result.document.accessKey).toBe(existingDoc.access_key);
      expect(db.getClient).not.toHaveBeenCalled();
      expect(sequentialService.getNext).not.toHaveBeenCalled();
      expect(documentModel.create).not.toHaveBeenCalled();
    });

    test('throws ConflictError (409) when the key exists but the payload differs', async () => {
      documentModel.findByIdempotencyKey.mockResolvedValue({
        ...existingDoc,
        payload_hash: 'completely-different-hash',
      });

      await expect(documentCreationService.create(validBody, IDEM_KEY, prodIssuer)).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(db.getClient).not.toHaveBeenCalled();
    });

    test('creates a new document with created:true when no idempotency key is provided', async () => {
      const result = await documentCreationService.create(validBody, null, prodIssuer);

      expect(result.created).toBe(true);
      expect(documentModel.findByIdempotencyKey).not.toHaveBeenCalled();
      expect(documentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: null, payloadHash: null }),
        mockClient
      );
    });

    test('creates a new document with created:true and stores the key + hash when the key is new', async () => {
      const result = await documentCreationService.create(validBody, IDEM_KEY, prodIssuer);

      expect(result.created).toBe(true);
      expect(documentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: IDEM_KEY, payloadHash }),
        mockClient
      );
    });

    test('on a concurrent-insert race (unique violation 23505), fetches and returns the winner as a replay', async () => {
      documentModel.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(existingDoc);
      documentModel.create.mockRejectedValue(Object.assign(new Error('duplicate key value'), { code: '23505' }));

      const result = await documentCreationService.create(validBody, IDEM_KEY, prodIssuer);

      expect(result.created).toBe(false);
      expect(result.document.accessKey).toBe(existingDoc.access_key);
      expect(documentModel.findByIdempotencyKey).toHaveBeenCalledTimes(2);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('re-throws a 23505 race error if no winner row can be found after all', async () => {
      documentModel.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      const raceError = Object.assign(new Error('duplicate key value'), { code: '23505' });
      documentModel.create.mockRejectedValue(raceError);

      await expect(documentCreationService.create(validBody, IDEM_KEY, prodIssuer)).rejects.toBe(raceError);
    });
  });

  describe('create — unexpected errors', () => {
    test('rolls back, releases the client, and re-throws on an unrelated DB error', async () => {
      const dbError = new Error('connection reset');
      documentModel.create.mockRejectedValue(dbError);

      await expect(documentCreationService.create(validBody, null, prodIssuer)).rejects.toBe(dbError);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('rolls back and re-throws without consulting idempotency lookup twice when no idempotency key was used', async () => {
      const dbError = new Error('connection reset');
      documentModel.create.mockRejectedValue(dbError);

      await expect(documentCreationService.create(validBody, null, prodIssuer)).rejects.toBe(dbError);
      expect(documentModel.findByIdempotencyKey).not.toHaveBeenCalled();
    });
  });

  describe('hashPayload', () => {
    test('produces the same hash for identical payloads', () => {
      const hash1 = documentCreationService.hashPayload(validBody);
      const hash2 = documentCreationService.hashPayload({ ...validBody });

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    test('produces different hashes for different payloads', () => {
      const hash1 = documentCreationService.hashPayload(validBody);
      const hash2 = documentCreationService.hashPayload({ ...validBody, documentType: '04' });

      expect(hash1).not.toBe(hash2);
    });
  });
});
