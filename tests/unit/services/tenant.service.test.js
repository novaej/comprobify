jest.mock('../../../src/models/tenant.model');
jest.mock('../../../src/models/subscription.model');
jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/models/api-key.model');
jest.mock('../../../src/models/issuer-document-type.model');
jest.mock('../../../src/services/sequential.service');
jest.mock('../../../src/services/subscription.service');

const tenantModel = require('../../../src/models/tenant.model');
const subscriptionModel = require('../../../src/models/subscription.model');
const issuerModel = require('../../../src/models/issuer.model');
const apiKeyModel = require('../../../src/models/api-key.model');
const issuerDocumentTypeModel = require('../../../src/models/issuer-document-type.model');
const sequentialService = require('../../../src/services/sequential.service');
const subscriptionService = require('../../../src/services/subscription.service');
const tenantService = require('../../../src/services/tenant.service');

describe('TenantService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('promote', () => {
    beforeEach(() => {
      issuerModel.findAllByTenantId.mockResolvedValue([]);
      apiKeyModel.findActiveByTenantId.mockResolvedValue([]);
      tenantModel.promote.mockResolvedValue({ id: 1, sandbox: false });
      subscriptionModel.findActiveByTenantId.mockResolvedValue(null);
    });

    test('rejects when the tenant does not exist', async () => {
      tenantModel.findById.mockResolvedValue(null);

      await expect(tenantService.promote(1)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('rejects when the tenant has not verified their email', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, status: 'PENDING_VERIFICATION', sandbox: true });

      await expect(tenantService.promote(1)).rejects.toMatchObject({
        statusCode: 403,
        code: 'EMAIL_VERIFICATION_REQUIRED',
      });
    });

    test('rejects when the tenant is already in production', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, status: 'ACTIVE', sandbox: false });

      await expect(tenantService.promote(1)).rejects.toMatchObject({ statusCode: 409 });
    });

    test('with no tier requested and no prior subscription, promotes without starting billing', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, status: 'ACTIVE', sandbox: true });

      const result = await tenantService.promote(1);

      expect(subscriptionService.createSubscription).not.toHaveBeenCalled();
      expect(result).toEqual({ apiKeys: [] });
    });

    test('with a tier requested and no prior subscription, kicks off the subscription pipeline', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, status: 'ACTIVE', sandbox: true });
      subscriptionService.createSubscription.mockResolvedValue({
        subscription: { id: 10, tier: 'STARTER' },
        payment: { id: 20 },
        bankTransfer: { bankName: 'Banco' },
      });

      const result = await tenantService.promote(1, [], 'STARTER', 'MONTHLY');

      expect(subscriptionService.createSubscription).toHaveBeenCalledWith(1, 'STARTER', 'MONTHLY');
      expect(result).toEqual({
        apiKeys: [],
        subscription: { id: 10, tier: 'STARTER' },
        payment: { id: 20 },
        bankTransfer: { bankName: 'Banco' },
      });
    });

    test('when an ACTIVE subscription already exists (started while in sandbox), skips tier selection entirely and surfaces it', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, status: 'ACTIVE', sandbox: true });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({ id: 10, tier: 'GROWTH', status: 'ACTIVE' });

      const result = await tenantService.promote(1, [], 'STARTER', 'MONTHLY');

      expect(subscriptionService.createSubscription).not.toHaveBeenCalled();
      expect(result).toEqual({ apiKeys: [], subscription: { id: 10, tier: 'GROWTH', status: 'ACTIVE' } });
    });

    test('rotates sandbox API keys to production, preserving labels', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, status: 'ACTIVE', sandbox: true });
      apiKeyModel.findActiveByTenantId.mockResolvedValue([
        { label: 'frontend-prod' },
        { label: 'erp' },
      ]);

      const result = await tenantService.promote(1);

      expect(apiKeyModel.revokeAllByTenantIdAndEnvironment).toHaveBeenCalledWith(1, 'sandbox');
      expect(apiKeyModel.create).toHaveBeenCalledTimes(2);
      expect(result.apiKeys).toEqual([
        { label: 'frontend-prod', apiKey: expect.any(String) },
        { label: 'erp', apiKey: expect.any(String) },
      ]);
    });

    test('seeds sequentials for every issuer x active document type', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, status: 'ACTIVE', sandbox: true });
      issuerModel.findAllByTenantId.mockResolvedValue([
        { id: 5, branch_code: '001', issue_point_code: '001' },
      ]);
      issuerDocumentTypeModel.findActiveByIssuerId.mockResolvedValue(['01', '04']);

      await tenantService.promote(1, [{ issuerId: 5, documentType: '01', sequential: 7 }]);

      expect(sequentialService.initialize).toHaveBeenCalledWith(5, '001', '001', '01', 7, false);
      expect(sequentialService.initialize).toHaveBeenCalledWith(5, '001', '001', '04', 1, false);
    });
  });
});
