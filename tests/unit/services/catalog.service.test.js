jest.mock('../../../src/models/catalog.model');

const catalogModel = require('../../../src/models/catalog.model');
const catalogService = require('../../../src/services/catalog.service');

describe('CatalogService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listIdTypes', () => {
    test('returns the id types from the model', async () => {
      const idTypes = [{ code: '04', name: 'RUC' }, { code: '05', name: 'Cedula' }];
      catalogModel.listIdTypes.mockResolvedValue(idTypes);

      const result = await catalogService.listIdTypes();

      expect(catalogModel.listIdTypes).toHaveBeenCalledWith();
      expect(result).toBe(idTypes);
    });
  });

  describe('listPaymentMethods', () => {
    test('returns the payment methods from the model', async () => {
      const methods = [{ code: '01', name: 'Efectivo' }];
      catalogModel.listPaymentMethods.mockResolvedValue(methods);

      const result = await catalogService.listPaymentMethods();

      expect(catalogModel.listPaymentMethods).toHaveBeenCalledWith();
      expect(result).toBe(methods);
    });
  });

  describe('listTermUnits', () => {
    test('returns the term units from the model', async () => {
      const units = [{ code: 'dias', name: 'Dias' }];
      catalogModel.listTermUnits.mockResolvedValue(units);

      const result = await catalogService.listTermUnits();

      expect(catalogModel.listTermUnits).toHaveBeenCalledWith();
      expect(result).toBe(units);
    });
  });

  describe('listTaxTypes', () => {
    test('returns the tax types from the model', async () => {
      const taxTypes = [{ code: '2', name: 'IVA' }];
      catalogModel.listTaxTypes.mockResolvedValue(taxTypes);

      const result = await catalogService.listTaxTypes();

      expect(catalogModel.listTaxTypes).toHaveBeenCalledWith();
      expect(result).toBe(taxTypes);
    });
  });

  describe('listTaxRates', () => {
    test('returns the tax rates from the model', async () => {
      const taxRates = [{ code: '4', percentage: 15 }];
      catalogModel.listTaxRates.mockResolvedValue(taxRates);

      const result = await catalogService.listTaxRates();

      expect(catalogModel.listTaxRates).toHaveBeenCalledWith();
      expect(result).toBe(taxRates);
    });
  });
});
