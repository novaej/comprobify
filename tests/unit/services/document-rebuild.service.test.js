jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/document-line-item.model');
jest.mock('../../../src/models/document-event.model');
jest.mock('../../../src/services/signing.service');
jest.mock('../../../src/services/xml-validator.service');
jest.mock('../../../src/builders');
// Mocked so ambiente logic can be exercised for both staging and production
// without depending on the actual APP_ENV of the test runner.
jest.mock('../../../src/config', () => ({ appEnv: 'production' }));

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
const signingService = require('../../../src/services/signing.service');
const xmlValidator = require('../../../src/services/xml-validator.service');
const builders = require('../../../src/builders');
const documentRebuildService = require('../../../src/services/document-rebuild.service');

const mockIssuer = {
  id: 5,
  sandbox: true,
  branch_code: '001',
  issue_point_code: '001',
  encrypted_private_key: 'encrypted-private-key',
  certificate_pem: '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----',
};

const accessKey = '1234567890123456789012345678901234567890123456789';

const returnedDocument = {
  id: 10,
  status: 'RETURNED',
  access_key: accessKey,
  sequential: 7,
  document_type: '01',
  issue_date: new Date('2026-01-15T12:00:00Z'),
};

const body = {
  buyer: { id: '1712345678001', name: 'BUYER S.A.', idType: '04', email: 'buyer@example.com' },
  items: [{ mainCode: '001', description: 'SERVICE', quantity: '1.000000', unitPrice: '100.000000' }],
  payments: [{ method: '20', total: '112.00' }],
};

describe('DocumentRebuildService', () => {
  let mockBuilder;

  beforeEach(() => {
    jest.clearAllMocks();

    db.getClient.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({});

    mockBuilder = {
      build: jest.fn().mockReturnValue('<factura>unsigned</factura>'),
      subtotal: '100.00',
      total: '112.00',
    };
    builders.getBuilder.mockReturnValue(mockBuilder);
    xmlValidator.validate.mockResolvedValue({ valid: true });
    signingService.signXml.mockReturnValue('<factura>signed</factura>');

    documentModel.findByAccessKey.mockResolvedValue(returnedDocument);
    documentModel.updateStatus.mockResolvedValue({
      ...returnedDocument,
      status: 'SIGNED',
      buyer_id: body.buyer.id,
      buyer_name: body.buyer.name,
      buyer_id_type: body.buyer.idType,
      buyer_email: body.buyer.email,
      total: '112.00',
    });
    documentLineItemModel.deleteByDocumentId.mockResolvedValue();
    documentLineItemModel.bulkCreate.mockResolvedValue([]);
    documentEventModel.create.mockResolvedValue({});
  });

  test('throws NotFoundError when the document does not exist', async () => {
    documentModel.findByAccessKey.mockResolvedValue(null);

    await expect(documentRebuildService.rebuild(accessKey, body, mockIssuer))
      .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(builders.getBuilder).not.toHaveBeenCalled();
  });

  test('throws INVALID_STATE_TRANSITION when the document cannot move to SIGNED', async () => {
    documentModel.findByAccessKey.mockResolvedValue({ ...returnedDocument, status: 'AUTHORIZED' });

    await expect(documentRebuildService.rebuild(accessKey, body, mockIssuer))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_STATE_TRANSITION' });
    expect(builders.getBuilder).not.toHaveBeenCalled();
    expect(db.getClient).not.toHaveBeenCalled();
  });

  test('allows rebuild from NOT_AUTHORIZED as well as RETURNED', async () => {
    documentModel.findByAccessKey.mockResolvedValue({ ...returnedDocument, status: 'NOT_AUTHORIZED' });

    const result = await documentRebuildService.rebuild(accessKey, body, mockIssuer);

    expect(result.status).toBe('SIGNED');
  });

  test('builds with the correct builder, signs, persists, and returns the formatted document', async () => {
    const result = await documentRebuildService.rebuild(accessKey, body, mockIssuer);

    expect(builders.getBuilder).toHaveBeenCalledWith('01', expect.objectContaining({ ...mockIssuer, environment: '1' }));
    expect(mockBuilder.build).toHaveBeenCalledWith(
      { ...body, issueDate: '15/01/2026' },
      returnedDocument.access_key,
      returnedDocument.sequential
    );
    expect(xmlValidator.validate).toHaveBeenCalledWith('<factura>unsigned</factura>', '01');
    expect(signingService.signXml).toHaveBeenCalledWith(
      '<factura>unsigned</factura>', 'encrypted-private-key',
      '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----'
    );

    expect(db.getClient).toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(db.setIssuerContext).toHaveBeenCalledWith(mockClient, 5, true);

    expect(documentModel.updateStatus).toHaveBeenCalledWith(10, 'SIGNED', {
      unsigned_xml: '<factura>unsigned</factura>',
      signed_xml: '<factura>signed</factura>',
      request_payload: JSON.stringify(body),
      subtotal: '100.00',
      total: '112.00',
      buyer_id: body.buyer.id,
      buyer_name: body.buyer.name,
      buyer_id_type: body.buyer.idType,
      buyer_email: body.buyer.email,
    }, 5, true, mockClient);

    expect(documentLineItemModel.deleteByDocumentId).toHaveBeenCalledWith(10, mockClient);
    expect(documentLineItemModel.bulkCreate).toHaveBeenCalledWith(10, body.items, mockClient);
    expect(documentEventModel.create).toHaveBeenCalledWith(10, 'REBUILT', 'RETURNED', 'SIGNED', {}, mockClient);

    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();

    expect(result.status).toBe('SIGNED');
    expect(result.accessKey).toBe(returnedDocument.access_key);
  });

  test('computes ambiente=2 when APP_ENV is production and the issuer is not sandboxed', async () => {
    const productionIssuer = { ...mockIssuer, sandbox: false };

    await documentRebuildService.rebuild(accessKey, body, productionIssuer);

    expect(builders.getBuilder).toHaveBeenCalledWith('01', expect.objectContaining({ environment: '2' }));
    expect(db.setIssuerContext).toHaveBeenCalledWith(mockClient, 5, false);
  });

  test('throws ValidationError when the payments total does not match the invoice total', async () => {
    const mismatchedBody = { ...body, payments: [{ method: '20', total: '999.00' }] };

    await expect(documentRebuildService.rebuild(accessKey, mismatchedBody, mockIssuer))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED' });
    expect(xmlValidator.validate).not.toHaveBeenCalled();
    expect(signingService.signXml).not.toHaveBeenCalled();
  });

  test('skips the payments-total check when body.payments is not an array', async () => {
    const { payments, ...bodyWithoutPayments } = body;

    const result = await documentRebuildService.rebuild(accessKey, bodyWithoutPayments, mockIssuer);

    expect(result.status).toBe('SIGNED');
  });

  test('throws ValidationError when XSD validation fails', async () => {
    xmlValidator.validate.mockResolvedValue({ valid: false, errors: [{ message: 'bad element' }] });

    await expect(documentRebuildService.rebuild(accessKey, body, mockIssuer))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED', errors: [{ message: 'bad element' }] });
    expect(signingService.signXml).not.toHaveBeenCalled();
  });

  test('rolls back the transaction, releases the client, and rethrows on a persistence failure', async () => {
    const dbError = new Error('unique constraint violation');
    documentLineItemModel.bulkCreate.mockRejectedValue(dbError);

    await expect(documentRebuildService.rebuild(accessKey, body, mockIssuer)).rejects.toThrow('unique constraint violation');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
  });
});
