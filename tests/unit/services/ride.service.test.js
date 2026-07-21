jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/models/catalog.model');
jest.mock('../../../helpers/ride-builder');

const documentModel = require('../../../src/models/document.model');
const issuerModel = require('../../../src/models/issuer.model');
const catalogModel = require('../../../src/models/catalog.model');
const rideBuilder = require('../../../helpers/ride-builder');
const config = require('../../../src/config');
const DocumentStatus = require('../../../src/constants/document-status');
const rideService = require('../../../src/services/ride.service');

describe('RideService', () => {
  const baseIssuer = {
    id: '00000000-0000-0000-0000-000000000007',
    ruc: '1234567890001',
    business_name: 'Acme SA',
    trade_name: 'Acme',
    main_address: 'Av. Principal',
    branch_address: 'Sucursal Norte',
    special_taxpayer: null,
    required_accounting: null,
    logo: null,
    branch_code: '001',
    issue_point_code: '001',
    emission_type: '1',
    sandbox: true,
  };

  const baseDocument = {
    id: '00000000-0000-0000-0000-000000000042',
    issuer_id: '00000000-0000-0000-0000-000000000007',
    status: DocumentStatus.AUTHORIZED,
    authorization_number: 'AUTH-1',
    authorization_date: '2026-06-01',
    document_type: '01',
    access_key: '1'.repeat(49),
    sequential: 5,
    issue_date: '2026-06-01',
    buyer_name: 'John Doe',
    buyer_id: '0999999999',
    buyer_id_type: '05',
    subtotal: 100,
    total: 115,
    request_payload: {
      items: [],
      payments: [],
    },
  };

  const originalAppEnv = config.appEnv;

  afterEach(() => {
    jest.clearAllMocks();
    config.appEnv = originalAppEnv;
  });

  beforeEach(() => {
    catalogModel.getIdTypeLabel.mockResolvedValue('CEDULA');
    catalogModel.getPaymentMethodLabel.mockResolvedValue('EFECTIVO');
    catalogModel.getTermUnitLabel.mockResolvedValue('DIAS');
    catalogModel.getDocumentTypeDescription.mockResolvedValue('FACTURA');
    catalogModel.getTaxRateDescription.mockResolvedValue('IVA 15%');
    rideBuilder.build.mockResolvedValue(Buffer.from('%PDF-FAKE'));
  });

  describe('generate', () => {
    test('throws NotFoundError when given an access key that resolves to no document', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);

      await expect(rideService.generate('nonexistent-key')).rejects.toMatchObject({ statusCode: 404 });
      expect(issuerModel.findById).not.toHaveBeenCalled();
    });

    test('looks up by access key with no issuer scoping when no issuerOverride is supplied', async () => {
      documentModel.findByAccessKey.mockResolvedValue(baseDocument);
      issuerModel.findById.mockResolvedValue(baseIssuer);

      await rideService.generate(baseDocument.access_key);

      expect(documentModel.findByAccessKey).toHaveBeenCalledWith(baseDocument.access_key, null, false);
      expect(issuerModel.findById).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000007');
    });

    test('scopes the lookup to the issuerOverride id/sandbox when supplied', async () => {
      const issuerOverride = { ...baseIssuer, id: '00000000-0000-0000-0000-000000000009', sandbox: true };
      documentModel.findByAccessKey.mockResolvedValue(baseDocument);

      await rideService.generate(baseDocument.access_key, issuerOverride);

      expect(documentModel.findByAccessKey).toHaveBeenCalledWith(baseDocument.access_key, '00000000-0000-0000-0000-000000000009', true);
      // issuerOverride is used directly — issuerModel.findById is never called
      expect(issuerModel.findById).not.toHaveBeenCalled();
    });

    test('accepts a document object directly, skipping the accessKey lookup entirely', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);

      await rideService.generate(baseDocument);

      expect(documentModel.findByAccessKey).not.toHaveBeenCalled();
      expect(issuerModel.findById).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000007');
    });

    test('throws DOCUMENT_NOT_AUTHORIZED when the document status is not AUTHORIZED', async () => {
      const signedDoc = { ...baseDocument, status: DocumentStatus.SIGNED };

      await expect(rideService.generate(signedDoc)).rejects.toMatchObject({
        statusCode: 400,
        code: 'DOCUMENT_NOT_AUTHORIZED',
      });
      expect(issuerModel.findById).not.toHaveBeenCalled();
      expect(rideBuilder.build).not.toHaveBeenCalled();
    });

    test('resolves the buyer id type label from the catalog', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);

      await rideService.generate(baseDocument);

      expect(catalogModel.getIdTypeLabel).toHaveBeenCalledWith('05');
      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.buyerIdTypeLabel).toBe('CEDULA');
    });

    test('resolves a methodLabel for every payment, and a termUnitLabel only when termUnit is present', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);
      const document = {
        ...baseDocument,
        request_payload: {
          items: [],
          payments: [
            { method: '01', total: 50 },
            { method: '20', total: 65, termUnit: 'dias' },
          ],
        },
      };

      await rideService.generate(document);

      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.payments).toEqual([
        { method: '01', total: 50, methodLabel: 'EFECTIVO' },
        { method: '20', total: 65, termUnit: 'dias', methodLabel: 'EFECTIVO', termUnitLabel: 'DIAS' },
      ]);
      expect(catalogModel.getTermUnitLabel).toHaveBeenCalledTimes(1);
      expect(catalogModel.getTermUnitLabel).toHaveBeenCalledWith('dias');
    });

    test('resolves originalDocument.documentTypeLabel for credit notes; null when no originalDocument', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);
      const document = {
        ...baseDocument,
        document_type: '04',
        request_payload: {
          items: [],
          originalDocument: { documentType: '01', number: '001-001-000000005' },
        },
      };

      await rideService.generate(document);

      expect(catalogModel.getDocumentTypeDescription).toHaveBeenCalledWith('01');
      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.originalDocument).toEqual({
        documentType: '01', number: '001-001-000000005', documentTypeLabel: 'FACTURA',
      });
    });

    test('originalDocument is null and getDocumentTypeDescription is skipped when the payload has none', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);

      await rideService.generate(baseDocument);

      expect(catalogModel.getDocumentTypeDescription).not.toHaveBeenCalled();
      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.originalDocument).toBeNull();
    });

    test('collects distinct tax rate descriptions keyed by "code|rateCode", deduplicating repeats', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);
      const document = {
        ...baseDocument,
        request_payload: {
          items: [
            { taxes: [{ code: '2', rateCode: '4' }, { code: '2', rateCode: '4' }] },
            { taxes: [{ code: '2', rateCode: '0' }] },
          ],
        },
      };

      await rideService.generate(document);

      expect(catalogModel.getTaxRateDescription).toHaveBeenCalledTimes(2);
      expect(catalogModel.getTaxRateDescription).toHaveBeenCalledWith('2', '4');
      expect(catalogModel.getTaxRateDescription).toHaveBeenCalledWith('2', '0');
      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.taxDescriptions).toEqual({ '2|4': 'IVA 15%', '2|0': 'IVA 15%' });
    });

    test('environment is "1" (PRUEBAS) when appEnv is not production, regardless of issuer.sandbox', async () => {
      config.appEnv = 'staging';
      issuerModel.findById.mockResolvedValue({ ...baseIssuer, sandbox: false });

      await rideService.generate(baseDocument);

      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.environment).toBe('1');
    });

    test('environment is "1" (PRUEBAS) when appEnv is production but the issuer is sandboxed', async () => {
      config.appEnv = 'production';
      issuerModel.findById.mockResolvedValue({ ...baseIssuer, sandbox: true });

      await rideService.generate(baseDocument);

      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.environment).toBe('1');
    });

    test('environment is "2" (PRODUCCION) only when appEnv is production AND the issuer is not sandboxed', async () => {
      config.appEnv = 'production';
      issuerModel.findById.mockResolvedValue({ ...baseIssuer, sandbox: false });

      await rideService.generate(baseDocument);

      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData.environment).toBe('2');
    });

    test('returns whatever rideBuilder.build resolves to', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);
      const pdfBuffer = Buffer.from('%PDF-SPECIFIC');
      rideBuilder.build.mockResolvedValue(pdfBuffer);

      const result = await rideService.generate(baseDocument);

      expect(result).toBe(pdfBuffer);
    });

    test('builds a rideData shape covering issuer, document, buyer, and totals fields', async () => {
      issuerModel.findById.mockResolvedValue(baseIssuer);

      await rideService.generate(baseDocument);

      const [rideData] = rideBuilder.build.mock.calls[0];
      expect(rideData).toMatchObject({
        authorizationNumber: 'AUTH-1',
        authorizationDate: '2026-06-01',
        ruc: '1234567890001',
        businessName: 'Acme SA',
        tradeName: 'Acme',
        mainAddress: 'Av. Principal',
        branchAddress: 'Sucursal Norte',
        logoBuffer: null,
        branchCode: '001',
        issuePointCode: '001',
        emissionType: '1',
        documentType: '01',
        accessKey: baseDocument.access_key,
        sequential: '000000005',
        issueDate: '2026-06-01',
        buyerName: 'John Doe',
        buyerId: '0999999999',
        buyerIdType: '05',
        subtotal: 100,
        total: 115,
        motivo: null,
        additionalInfo: null,
      });
    });
  });
});
