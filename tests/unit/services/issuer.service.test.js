jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/issuer-document-type.model');
jest.mock('../../../src/models/tenant.model');
jest.mock('../../../src/services/sequential.service');

const issuerModel = require('../../../src/models/issuer.model');
const documentModel = require('../../../src/models/document.model');
const issuerDocumentTypeModel = require('../../../src/models/issuer-document-type.model');
const tenantModel = require('../../../src/models/tenant.model');
const sequentialService = require('../../../src/services/sequential.service');
const issuerService = require('../../../src/services/issuer.service');

describe('IssuerService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('removeIssuer', () => {
    const issuer = { id: 1, tenant_id: 9, branch_code: '001', issue_point_code: '001' };

    test('deactivates the issuer when more than one active issuer exists and it has no documents', async () => {
      issuerModel.countActiveByTenantId.mockResolvedValue(2);
      documentModel.existsByIssuerId.mockResolvedValue(false);

      await issuerService.removeIssuer(issuer);

      expect(issuerModel.deactivate).toHaveBeenCalledWith(1, 9);
    });

    test('rejects when the issuer is the tenant\'s last remaining one', async () => {
      issuerModel.countActiveByTenantId.mockResolvedValue(1);

      await expect(issuerService.removeIssuer(issuer))
        .rejects.toMatchObject({ statusCode: 400, code: 'LAST_ISSUER_CANNOT_BE_REMOVED' });
      expect(documentModel.existsByIssuerId).not.toHaveBeenCalled();
      expect(issuerModel.deactivate).not.toHaveBeenCalled();
    });

    test('rejects when the issuer has issued documents', async () => {
      issuerModel.countActiveByTenantId.mockResolvedValue(2);
      documentModel.existsByIssuerId.mockResolvedValue(true);

      await expect(issuerService.removeIssuer(issuer))
        .rejects.toMatchObject({ statusCode: 400, code: 'ISSUER_HAS_DOCUMENTS' });
      expect(issuerModel.deactivate).not.toHaveBeenCalled();
    });
  });

  describe('getSequentials', () => {
    test('fetches active document types and delegates to sequentialService.getCounters', async () => {
      const issuer = { id: 1 };
      issuerDocumentTypeModel.findActiveByIssuerId.mockResolvedValue(['01', '04']);
      sequentialService.getCounters.mockResolvedValue([{ documentType: '01' }]);

      const result = await issuerService.getSequentials(issuer);

      expect(issuerDocumentTypeModel.findActiveByIssuerId).toHaveBeenCalledWith(1);
      expect(sequentialService.getCounters).toHaveBeenCalledWith(1, ['01', '04']);
      expect(result).toEqual([{ documentType: '01' }]);
    });
  });

  describe('setSequential', () => {
    const issuer = { id: 1, branch_code: '001', issue_point_code: '001' };

    test('translates environment to the sandbox boolean and delegates to sequentialService.setNext', async () => {
      await issuerService.setSequential(issuer, '01', 'sandbox', 10);

      expect(sequentialService.setNext).toHaveBeenCalledWith(1, '001', '001', '01', 10, true);
    });

    test('passes sandbox=false for production', async () => {
      await issuerService.setSequential(issuer, '01', 'production', 10);

      expect(sequentialService.setNext).toHaveBeenCalledWith(1, '001', '001', '01', 10, false);
    });
  });

  describe('activateIssuer', () => {
    const issuer = { id: 1, tenant_id: 9, branch_code: '001' };
    const tenant = { id: 9, subscriptionTier: 'STARTER' };

    test('reactivates the issuer when the branch is brand new and under the branch limit', async () => {
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(1); // STARTER maxBranches = 3
      issuerModel.activate.mockResolvedValue({ id: 1 });

      await issuerService.activateIssuer(issuer, tenant);

      expect(issuerModel.activate).toHaveBeenCalledWith(1, 9);
    });

    test('rejects when reactivating would exceed the branch limit', async () => {
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(3); // at STARTER's maxBranches

      await expect(issuerService.activateIssuer(issuer, tenant))
        .rejects.toMatchObject({ statusCode: 402, code: 'BRANCH_LIMIT_REACHED' });
      expect(issuerModel.activate).not.toHaveBeenCalled();
    });

    test('rejects when reactivating would exceed the issue-point-per-branch limit', async () => {
      tenantModel.countIssuePointsByBranch.mockResolvedValue(2); // at STARTER's maxIssuePointsPerBranch

      await expect(issuerService.activateIssuer(issuer, tenant))
        .rejects.toMatchObject({ statusCode: 402, code: 'ISSUE_POINT_LIMIT_REACHED' });
      expect(issuerModel.activate).not.toHaveBeenCalled();
    });

    test('skips both limit checks for an unlimited (BUSINESS) tier', async () => {
      tenantModel.countIssuePointsByBranch.mockResolvedValue(5);
      issuerModel.activate.mockResolvedValue({ id: 1 });

      await issuerService.activateIssuer(issuer, { id: 9, subscriptionTier: 'BUSINESS' });

      expect(tenantModel.countBranchesByTenantId).not.toHaveBeenCalled();
      expect(issuerModel.activate).toHaveBeenCalledWith(1, 9);
    });

    test('throws NotFoundError when the issuer was not actually inactive', async () => {
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(1);
      issuerModel.activate.mockResolvedValue(null);

      await expect(issuerService.activateIssuer(issuer, tenant))
        .rejects.toMatchObject({ statusCode: 404, code: 'ISSUER_NOT_FOUND' });
    });
  });
});
