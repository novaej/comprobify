jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/invoice-detail.model');
jest.mock('../../../src/models/document-event.model');
jest.mock('../../../src/models/client.model');
jest.mock('../../../src/services/sequential.service');
jest.mock('../../../src/services/access-key.service');
jest.mock('../../../src/services/signing.service');
jest.mock('../../../src/services/xml-validator.service');
jest.mock('../../../src/builders');

// Mock the database module so the service can obtain a transaction client
const mockClient = {
  query: jest.fn().mockResolvedValue({}),
  release: jest.fn(),
};
jest.mock('../../../src/config/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const db = require('../../../src/config/database');
const issuerModel = require('../../../src/models/issuer.model');
const documentModel = require('../../../src/models/document.model');
const invoiceDetailModel = require('../../../src/models/invoice-detail.model');
const documentEventModel = require('../../../src/models/document-event.model');
const clientModel = require('../../../src/models/client.model');
const sequentialService = require('../../../src/services/sequential.service');
const accessKeyService = require('../../../src/services/access-key.service');
const signingService = require('../../../src/services/signing.service');
const xmlValidator = require('../../../src/services/xml-validator.service');
const builders = require('../../../src/builders');
const documentService = require('../../../src/services/document.service');

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
  cert_path: 'cert/token.p12',
  cert_password_enc: 'encrypted-password',
  branch_address: 'AV. TEST',
};

const validBody = {
  issueDate: '26/02/2026',
  buyer: { idType: '04', id: '1712345678001', name: 'BUYER S.A.', address: 'ADDRESS' },
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

describe('DocumentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    db.getClient.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({});

    issuerModel.findFirst.mockResolvedValue(mockIssuer);
    sequentialService.getNext.mockResolvedValue(263);
    accessKeyService.generate.mockResolvedValue('2602202601171234567800110010010000002630000026311');

    const mockBuilder = {
      build: jest.fn().mockReturnValue('<factura>xml</factura>'),
      subtotal: '100.00',
      total: '112.00',
    };
    builders.getBuilder.mockReturnValue(mockBuilder);
    signingService.signXml.mockReturnValue('<factura>signed-xml</factura>');
    xmlValidator.validate.mockReturnValue({ valid: true });
    invoiceDetailModel.bulkCreate.mockResolvedValue([]);
    documentEventModel.create.mockResolvedValue({});
    clientModel.findOrCreate.mockResolvedValue({});

    documentModel.create.mockResolvedValue({
      id: 1,
      access_key: '2602202601171234567800110010010000002630000026311',
      sequential: 263,
      status: 'SIGNED',
      issue_date: new Date('2026-02-26'),
      total: '112.00',
    });
  });

  test('create calls services in correct order and saves document', async () => {
    const result = await documentService.create(validBody);

    expect(issuerModel.findFirst).toHaveBeenCalled();
    // sequential is now called with the transaction client as the 5th argument
    expect(sequentialService.getNext).toHaveBeenCalledWith(1, '001', '001', '01', mockClient);
    expect(accessKeyService.generate).toHaveBeenCalled();
    expect(builders.getBuilder).toHaveBeenCalledWith('01', mockIssuer);
    expect(signingService.signXml).toHaveBeenCalledWith(
      '<factura>xml</factura>',
      'cert/token.p12',
      'encrypted-password'
    );
    expect(documentModel.create).toHaveBeenCalled();
    expect(result.status).toBe('SIGNED');
    expect(result.accessKey).toBeDefined();
    expect(result.sequential).toBe('000000263');
  });

  test('create commits the transaction on success', async () => {
    await documentService.create(validBody);
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('create rolls back the transaction and releases client on error', async () => {
    xmlValidator.validate.mockReturnValue({
      valid: false,
      errors: [{ message: 'Element infoFactura is not valid' }],
    });
    await expect(documentService.create(validBody)).rejects.toMatchObject({ statusCode: 400 });
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('create throws when no issuer configured', async () => {
    issuerModel.findFirst.mockResolvedValue(null);
    await expect(documentService.create(validBody)).rejects.toThrow('No active issuer configured');
  });

  test('create throws ValidationError when XSD validation fails', async () => {
    xmlValidator.validate.mockReturnValue({
      valid: false,
      errors: [{ message: 'Element infoFactura is not valid' }],
    });
    await expect(documentService.create(validBody)).rejects.toMatchObject({
      statusCode: 400,
      errors: [{ message: 'Element infoFactura is not valid' }],
    });
  });

  test('create persists invoice_details and logs CREATED event', async () => {
    await documentService.create(validBody);
    expect(invoiceDetailModel.bulkCreate).toHaveBeenCalledWith(1, validBody.items, mockClient);
    expect(documentEventModel.create).toHaveBeenCalledWith(
      1, 'CREATED', null, 'SIGNED', expect.any(Object), mockClient
    );
  });

  test('getByAccessKey returns formatted document', async () => {
    documentModel.findByAccessKey.mockResolvedValue({
      access_key: '2602202601171234567800110010010000002630000026311',
      sequential: 263,
      status: 'SIGNED',
      issue_date: new Date('2026-02-26'),
      total: '112.00',
    });

    const result = await documentService.getByAccessKey('2602202601171234567800110010010000002630000026311');
    expect(result.accessKey).toBe('2602202601171234567800110010010000002630000026311');
    expect(result.status).toBe('SIGNED');
  });

  test('getByAccessKey returns null for unknown key', async () => {
    documentModel.findByAccessKey.mockResolvedValue(null);
    const result = await documentService.getByAccessKey('0000000000000000000000000000000000000000000000000');
    expect(result).toBeNull();
  });

  test('sendToSri rejects when status is not SIGNED', async () => {
    documentModel.findByAccessKey.mockResolvedValue({
      id: 1,
      status: 'AUTHORIZED',
      signed_xml: '<xml/>',
    });

    await expect(documentService.sendToSri('1234567890123456789012345678901234567890123456789'))
      .rejects.toThrow('Cannot send document with status AUTHORIZED');
  });

  test('checkAuthorization rejects when status is not RECEIVED or NOT_AUTHORIZED', async () => {
    documentModel.findByAccessKey.mockResolvedValue({
      id: 1,
      status: 'SIGNED',
    });

    await expect(documentService.checkAuthorization('1234567890123456789012345678901234567890123456789'))
      .rejects.toThrow('Cannot check authorization for document with status SIGNED');
  });
});
