jest.mock('../../../src/config/database');
jest.mock('../../../src/models/tenant.model');
jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/models/api-key.model');
jest.mock('../../../src/models/issuer-document-type.model');
jest.mock('../../../src/models/tenant-event.model');
jest.mock('../../../src/services/sequential.service');
jest.mock('../../../src/services/tenant-quota.service');
jest.mock('../../../src/services/crypto.service');
jest.mock('../../../src/services/certificate.service');

const crypto = require('crypto');
const db = require('../../../src/config/database');
const tenantModel = require('../../../src/models/tenant.model');
const issuerModel = require('../../../src/models/issuer.model');
const apiKeyModel = require('../../../src/models/api-key.model');
const issuerDocumentTypeModel = require('../../../src/models/issuer-document-type.model');
const tenantEventModel = require('../../../src/models/tenant-event.model');
const sequentialService = require('../../../src/services/sequential.service');
const tenantQuotaService = require('../../../src/services/tenant-quota.service');
const cryptoService = require('../../../src/services/crypto.service');
const certificateService = require('../../../src/services/certificate.service');
const adminService = require('../../../src/services/admin.service');

describe('AdminService', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    db.getClient.mockResolvedValue(mockClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createTenant', () => {
    test('rejects when a tenant with the email already exists', async () => {
      tenantModel.findByEmail.mockResolvedValue({ id: 1 });

      await expect(adminService.createTenant({ email: 'a@b.com' }))
        .rejects.toMatchObject({ statusCode: 409 });
      expect(tenantModel.create).not.toHaveBeenCalled();
    });

    test('defaults to the FREE tier and its quota when no tier is supplied', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({
        id: 1, email: 'a@b.com', subscription_tier: 'FREE', status: 'ACTIVE',
        created_at: new Date('2026-01-01'),
      });
      tenantQuotaService.initializeForTenant.mockResolvedValue({ document_quota: 5, document_count: 0 });

      const result = await adminService.createTenant({ email: 'a@b.com' });

      expect(tenantModel.create).toHaveBeenCalledWith({
        email: 'a@b.com', subscriptionTier: 'FREE', status: 'ACTIVE',
      }, mockClient);
      expect(tenantQuotaService.initializeForTenant).toHaveBeenCalledWith(1, 5, mockClient);
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(result).toEqual({
        id: 1, email: 'a@b.com', subscriptionTier: 'FREE', status: 'ACTIVE',
        documentQuota: 5, documentCount: 0, createdAt: new Date('2026-01-01'),
      });
    });

    test('creates a tenant with an explicit tier and its matching quota', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);
      tenantModel.create.mockResolvedValue({
        id: 2, email: 'b@c.com', subscription_tier: 'GROWTH', status: 'ACTIVE',
        created_at: new Date('2026-01-01'),
      });
      tenantQuotaService.initializeForTenant.mockResolvedValue({ document_quota: 1000, document_count: 0 });

      await adminService.createTenant({ email: 'b@c.com', subscriptionTier: 'GROWTH' });

      expect(tenantModel.create).toHaveBeenCalledWith({
        email: 'b@c.com', subscriptionTier: 'GROWTH', status: 'ACTIVE',
      }, mockClient);
      expect(tenantQuotaService.initializeForTenant).toHaveBeenCalledWith(2, 1000, mockClient);
    });

    // NOTE: unlike updateTenantTier, createTenant does not validate the supplied
    // subscriptionTier against TIERS — an unrecognized value is passed straight
    // through to tenantModel.create, only the *quota* falls back to FREE's.
    // Documented here as observed behavior, not asserted as desirable.
    test('rejects an unrecognized tier', async () => {
      tenantModel.findByEmail.mockResolvedValue(null);

      await expect(adminService.createTenant({ email: 'c@d.com', subscriptionTier: 'BOGUS' }))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TIER' });
      expect(tenantModel.create).not.toHaveBeenCalled();
    });
  });

  describe('listTenants', () => {
    test('returns all tenants formatted', async () => {
      tenantModel.findAll.mockResolvedValue([
        { id: 1, email: 'a@b.com', subscription_tier: 'FREE', status: 'ACTIVE', created_at: new Date('2026-01-01') },
      ]);
      tenantQuotaService.getCurrentForTenants.mockResolvedValue(
        new Map([[1, { document_quota: 5, document_count: 1 }]])
      );

      const result = await adminService.listTenants();

      expect(tenantQuotaService.getCurrentForTenants).toHaveBeenCalledWith([1]);
      expect(result).toEqual([
        { id: 1, email: 'a@b.com', subscriptionTier: 'FREE', status: 'ACTIVE', documentQuota: 5, documentCount: 1, createdAt: new Date('2026-01-01') },
      ]);
    });
  });

  describe('updateTenantTier', () => {
    test('rejects an unknown tier', async () => {
      await expect(adminService.updateTenantTier(1, 'BOGUS'))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TIER' });
      expect(tenantModel.findById).not.toHaveBeenCalled();
    });

    test('rejects when the tenant does not exist', async () => {
      tenantModel.findById.mockResolvedValue(null);

      await expect(adminService.updateTenantTier(1, 'GROWTH'))
        .rejects.toMatchObject({ statusCode: 404 });
      expect(tenantModel.updateTier).not.toHaveBeenCalled();
    });

    test('updates the tier, seeds the new quota, and logs a TIER_CHANGED event', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'STARTER' });
      tenantModel.updateTier.mockResolvedValue({
        id: 1, email: 'a@b.com', subscription_tier: 'GROWTH', status: 'ACTIVE',
        created_at: new Date('2026-01-01'),
      });
      tenantQuotaService.setCap.mockResolvedValue({ document_quota: 1000, document_count: 0 });

      const result = await adminService.updateTenantTier(1, 'GROWTH');

      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'GROWTH');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith(1, 'GROWTH');
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGED', { from: 'STARTER', to: 'GROWTH' });
      expect(result.subscriptionTier).toBe('GROWTH');
      expect(result.documentQuota).toBe(1000);
    });
  });

  describe('updateTenantStatus', () => {
    test('rejects an invalid status', async () => {
      await expect(adminService.updateTenantStatus(1, 'BOGUS'))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TENANT_STATUS' });
      expect(tenantModel.updateStatus).not.toHaveBeenCalled();
    });

    test('rejects when the tenant does not exist', async () => {
      tenantModel.findById.mockResolvedValue(null);

      await expect(adminService.updateTenantStatus(1, 'SUSPENDED'))
        .rejects.toMatchObject({ statusCode: 404 });
      expect(tenantModel.updateStatus).not.toHaveBeenCalled();
    });

    test('updates the status, logs a STATUS_CHANGED event with from/to, and returns the formatted tenant', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, status: 'ACTIVE' });
      tenantModel.updateStatus.mockResolvedValue({
        id: 1, email: 'a@b.com', subscription_tier: 'FREE', status: 'SUSPENDED',
        created_at: new Date('2026-01-01'),
      });
      tenantQuotaService.getCurrentForTenant.mockResolvedValue({ document_quota: 5, document_count: 0 });

      const result = await adminService.updateTenantStatus(1, 'SUSPENDED');

      expect(tenantModel.updateStatus).toHaveBeenCalledWith(1, 'SUSPENDED');
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'STATUS_CHANGED', { from: 'ACTIVE', to: 'SUSPENDED' });
      expect(result.status).toBe('SUSPENDED');
    });
  });

  describe('verifyTenant', () => {
    test('rejects when the tenant does not exist', async () => {
      tenantModel.activate.mockResolvedValue(null);

      await expect(adminService.verifyTenant(1)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('activates the tenant and returns the formatted result', async () => {
      tenantModel.activate.mockResolvedValue({
        id: 1, email: 'a@b.com', subscription_tier: 'FREE', status: 'ACTIVE',
        created_at: new Date('2026-01-01'),
      });
      tenantQuotaService.getCurrentForTenant.mockResolvedValue({ document_quota: 5, document_count: 0 });

      const result = await adminService.verifyTenant(1);

      expect(tenantModel.activate).toHaveBeenCalledWith(1);
      expect(result.status).toBe('ACTIVE');
    });
  });

  describe('listTenantEvents', () => {
    test('rejects when the tenant does not exist', async () => {
      tenantModel.findById.mockResolvedValue(null);

      await expect(adminService.listTenantEvents(1)).rejects.toMatchObject({ statusCode: 404 });
      expect(tenantEventModel.findByTenantId).not.toHaveBeenCalled();
    });

    test('returns the tenant event log mapped to the camelCase response shape', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1 });
      const createdAt = new Date('2026-06-01T00:00:00Z');
      tenantEventModel.findByTenantId.mockResolvedValue([
        { id: 100, event_type: 'TIER_CHANGED', detail: { from: 'FREE', to: 'GROWTH' }, created_at: createdAt },
      ]);

      const result = await adminService.listTenantEvents(1);

      expect(tenantEventModel.findByTenantId).toHaveBeenCalledWith(1);
      expect(result).toEqual([
        { id: 100, eventType: 'TIER_CHANGED', detail: { from: 'FREE', to: 'GROWTH' }, createdAt },
      ]);
    });
  });

  describe('createIssuer', () => {
    const baseFields = {
      tenantId: 1, ruc: '1234567890001', businessName: 'Acme', branchCode: '001',
      issuePointCode: '001', emissionType: '1',
    };
    const p12Buffer = Buffer.from('fake-p12');

    test('rejects when the tenant does not exist', async () => {
      tenantModel.findById.mockResolvedValue(null);

      await expect(adminService.createIssuer(baseFields, p12Buffer, 'pw'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    test('rejects with BRANCH_LIMIT_REACHED when creating a new branch at the plan cap', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'STARTER', sandbox: true }); // maxBranches = 3
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(3);

      await expect(adminService.createIssuer(baseFields, p12Buffer, 'pw'))
        .rejects.toMatchObject({ statusCode: 402, code: 'BRANCH_LIMIT_REACHED' });
      expect(issuerModel.create).not.toHaveBeenCalled();
    });

    test('allows creating a new branch under the plan cap', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'STARTER', sandbox: true });
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(2);
      certificateService.parseCertificate.mockReturnValue({ privateKeyPem: 'pk', certPem: 'cert', certFingerprint: 'fp', certExpiry: new Date() });
      cryptoService.encrypt.mockReturnValue('enc');
      issuerModel.create.mockResolvedValue({ id: 10, branch_code: '001', issue_point_code: '001' });

      await expect(adminService.createIssuer(baseFields, p12Buffer, 'pw')).resolves.toBeDefined();
      expect(issuerModel.create).toHaveBeenCalled();
    });

    test('BUSINESS tier (unlimited branches) skips the branch-count check entirely', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'BUSINESS', sandbox: true });
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      certificateService.parseCertificate.mockReturnValue({ privateKeyPem: 'pk', certPem: 'cert', certFingerprint: 'fp', certExpiry: new Date() });
      cryptoService.encrypt.mockReturnValue('enc');
      issuerModel.create.mockResolvedValue({ id: 10, branch_code: '001', issue_point_code: '001' });

      await adminService.createIssuer(baseFields, p12Buffer, 'pw');

      expect(tenantModel.countBranchesByTenantId).not.toHaveBeenCalled();
      expect(issuerModel.create).toHaveBeenCalled();
    });

    test('rejects with ISSUE_POINT_LIMIT_REACHED when adding an issue point at the branch cap', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'STARTER', sandbox: true }); // maxIssuePointsPerBranch = 2
      tenantModel.countIssuePointsByBranch.mockResolvedValue(2);

      await expect(adminService.createIssuer(baseFields, p12Buffer, 'pw'))
        .rejects.toMatchObject({ statusCode: 402, code: 'ISSUE_POINT_LIMIT_REACHED' });
      expect(issuerModel.create).not.toHaveBeenCalled();
    });

    test('BUSINESS tier (unlimited issue points) skips the issue-point check', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'BUSINESS', sandbox: true });
      tenantModel.countIssuePointsByBranch.mockResolvedValue(50);
      certificateService.parseCertificate.mockReturnValue({ privateKeyPem: 'pk', certPem: 'cert', certFingerprint: 'fp', certExpiry: new Date() });
      cryptoService.encrypt.mockReturnValue('enc');
      issuerModel.create.mockResolvedValue({ id: 10, branch_code: '001', issue_point_code: '001' });

      await adminService.createIssuer(baseFields, p12Buffer, 'pw');

      expect(issuerModel.create).toHaveBeenCalled();
    });

    test('parses the P12, encrypts the private key, and maps a truthy requiredAccounting to "SI"', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'STARTER', sandbox: true });
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(0);
      const certExpiry = new Date('2030-01-01');
      certificateService.parseCertificate.mockReturnValue({
        privateKeyPem: 'pk-pem', certPem: 'cert-pem', certFingerprint: 'abc123', certExpiry,
      });
      cryptoService.encrypt.mockReturnValue('encrypted-pk-value');
      issuerModel.create.mockResolvedValue({ id: 10, branch_code: '001', issue_point_code: '001' });

      await adminService.createIssuer({ ...baseFields, requiredAccounting: true }, p12Buffer, 'pw');

      expect(certificateService.parseCertificate).toHaveBeenCalledWith(p12Buffer, 'pw');
      expect(cryptoService.encrypt).toHaveBeenCalledWith('pk-pem');
      expect(issuerModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 1, ruc: baseFields.ruc, businessName: baseFields.businessName,
        encryptedPrivateKey: 'encrypted-pk-value', certificatePem: 'cert-pem',
        certFingerprint: 'abc123', certExpiry, requiredAccounting: 'SI',
      }));
    });

    test('maps a falsy requiredAccounting to "NO"', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'STARTER', sandbox: true });
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(0);
      certificateService.parseCertificate.mockReturnValue({ privateKeyPem: 'pk', certPem: 'cert', certFingerprint: 'fp', certExpiry: new Date() });
      cryptoService.encrypt.mockReturnValue('enc');
      issuerModel.create.mockResolvedValue({ id: 10, branch_code: '001', issue_point_code: '001' });

      await adminService.createIssuer(baseFields, p12Buffer, 'pw');

      expect(issuerModel.create).toHaveBeenCalledWith(expect.objectContaining({ requiredAccounting: 'NO' }));
    });

    test('rejects when sourceIssuerId does not resolve to an existing issuer', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'STARTER', sandbox: true });
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(0);
      issuerModel.findById.mockResolvedValue(null);

      await expect(adminService.createIssuer(baseFields, null, null, 99))
        .rejects.toMatchObject({ statusCode: 404, code: 'SOURCE_ISSUER_NOT_FOUND' });
    });

    test('rejects when the source issuer RUC does not match the supplied RUC', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'STARTER', sandbox: true });
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(0);
      issuerModel.findById.mockResolvedValue({ id: 5, ruc: '9999999999001' });

      await expect(adminService.createIssuer(baseFields, null, null, 5))
        .rejects.toMatchObject({ statusCode: 400, code: 'RUC_MISMATCH' });
    });

    test('copies certificate fields from the source issuer when branching without a P12', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'STARTER', sandbox: true });
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(0);
      const certExpiry = new Date('2030-01-01');
      issuerModel.findById.mockResolvedValue({
        id: 5, ruc: baseFields.ruc, encrypted_private_key: 'src-enc', certificate_pem: 'src-cert',
        cert_fingerprint: 'src-fp', cert_expiry: certExpiry,
      });
      issuerModel.create.mockResolvedValue({ id: 10, branch_code: '001', issue_point_code: '001' });

      await adminService.createIssuer(baseFields, null, null, 5);

      expect(certificateService.parseCertificate).not.toHaveBeenCalled();
      expect(issuerModel.create).toHaveBeenCalledWith(expect.objectContaining({
        encryptedPrivateKey: 'src-enc', certificatePem: 'src-cert', certFingerprint: 'src-fp', certExpiry,
      }));
    });

    test('translates a unique-constraint violation on issuer creation into a ConflictError', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'STARTER', sandbox: true });
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(0);
      certificateService.parseCertificate.mockReturnValue({ privateKeyPem: 'pk', certPem: 'cert', certFingerprint: 'fp', certExpiry: new Date() });
      cryptoService.encrypt.mockReturnValue('enc');
      const dupError = new Error('duplicate key value violates unique constraint');
      dupError.code = '23505';
      issuerModel.create.mockRejectedValue(dupError);

      await expect(adminService.createIssuer(baseFields, p12Buffer, 'pw'))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    test('rethrows a non-duplicate-key error from issuerModel.create unchanged', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'STARTER', sandbox: true });
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(0);
      certificateService.parseCertificate.mockReturnValue({ privateKeyPem: 'pk', certPem: 'cert', certFingerprint: 'fp', certExpiry: new Date() });
      cryptoService.encrypt.mockReturnValue('enc');
      const otherError = new Error('connection reset');
      issuerModel.create.mockRejectedValue(otherError);

      await expect(adminService.createIssuer(baseFields, p12Buffer, 'pw')).rejects.toThrow('connection reset');
    });

    test('defaults documentTypes to ["01"] and seeds sequential 1 when nothing is supplied', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'STARTER', sandbox: true });
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(0);
      certificateService.parseCertificate.mockReturnValue({ privateKeyPem: 'pk', certPem: 'cert', certFingerprint: 'fp', certExpiry: new Date() });
      cryptoService.encrypt.mockReturnValue('enc');
      issuerModel.create.mockResolvedValue({ id: 10, branch_code: '001', issue_point_code: '001' });

      await adminService.createIssuer(baseFields, p12Buffer, 'pw');

      expect(issuerDocumentTypeModel.bulkCreate).toHaveBeenCalledWith(10, ['01']);
      expect(sequentialService.initialize).toHaveBeenCalledWith(10, '001', '001', '01', 1, true);
    });

    test('dedupes requested documentTypes and seeds each from initialSequentials (falling back to 1)', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'GROWTH', sandbox: false });
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(0);
      certificateService.parseCertificate.mockReturnValue({ privateKeyPem: 'pk', certPem: 'cert', certFingerprint: 'fp', certExpiry: new Date() });
      cryptoService.encrypt.mockReturnValue('enc');
      issuerModel.create.mockResolvedValue({ id: 11, branch_code: '002', issue_point_code: '001' });

      await adminService.createIssuer({
        ...baseFields, documentTypes: ['01', '04', '01'],
        initialSequentials: [{ documentType: '01', sequential: '50' }],
      }, p12Buffer, 'pw');

      expect(issuerDocumentTypeModel.bulkCreate).toHaveBeenCalledWith(11, ['01', '04']);
      expect(sequentialService.initialize).toHaveBeenCalledWith(11, '002', '001', '01', 50, false);
      expect(sequentialService.initialize).toHaveBeenCalledWith(11, '002', '001', '04', 1, false);
    });

    test('returns the newly created issuer formatted', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, subscription_tier: 'STARTER', sandbox: true });
      tenantModel.countIssuePointsByBranch.mockResolvedValue(0);
      tenantModel.countBranchesByTenantId.mockResolvedValue(0);
      const certExpiry = new Date('2030-01-01');
      certificateService.parseCertificate.mockReturnValue({ privateKeyPem: 'pk', certPem: 'cert', certFingerprint: 'fp', certExpiry });
      cryptoService.encrypt.mockReturnValue('enc');
      issuerModel.create.mockResolvedValue({
        id: 10, tenant_id: 1, ruc: baseFields.ruc, business_name: 'Acme', trade_name: null,
        branch_code: '001', issue_point_code: '001', cert_fingerprint: 'fp', cert_expiry: certExpiry, active: true,
      });

      const result = await adminService.createIssuer(baseFields, p12Buffer, 'pw');

      expect(result).toEqual({
        issuer: {
          id: 10, tenantId: 1, ruc: baseFields.ruc, businessName: 'Acme', tradeName: null,
          branchCode: '001', issuePointCode: '001', certFingerprint: 'fp', certExpiry, active: true,
        },
      });
    });
  });

  describe('listIssuers', () => {
    test('returns all issuers formatted', async () => {
      issuerModel.findAll.mockResolvedValue([
        { id: 1, tenant_id: 1, ruc: '123', business_name: 'Acme', trade_name: null, branch_code: '001', issue_point_code: '001', cert_fingerprint: 'fp', cert_expiry: new Date('2030-01-01'), active: true },
      ]);

      const result = await adminService.listIssuers();

      expect(result).toEqual([
        { id: 1, tenantId: 1, ruc: '123', businessName: 'Acme', tradeName: null, branchCode: '001', issuePointCode: '001', certFingerprint: 'fp', certExpiry: new Date('2030-01-01'), active: true },
      ]);
    });
  });

  describe('createApiKey', () => {
    test('rejects when the tenant does not exist', async () => {
      tenantModel.findById.mockResolvedValue(null);

      await expect(adminService.createApiKey(1, 'label', 'sandbox')).rejects.toMatchObject({ statusCode: 404 });
    });

    test('defaults to sandbox when the tenant is still in sandbox and no environment is given', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, sandbox: true });
      apiKeyModel.create.mockResolvedValue({});

      await adminService.createApiKey(1, 'label', undefined);

      expect(apiKeyModel.create).toHaveBeenCalledWith(expect.objectContaining({ environment: 'sandbox' }));
    });

    test('defaults to production when the tenant has already been promoted and no environment is given', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, sandbox: false });
      apiKeyModel.create.mockResolvedValue({});

      await adminService.createApiKey(1, 'label', undefined);

      expect(apiKeyModel.create).toHaveBeenCalledWith(expect.objectContaining({ environment: 'production' }));
    });

    test('rejects an invalid environment value', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, sandbox: true });

      await expect(adminService.createApiKey(1, 'label', 'staging')).rejects.toMatchObject({ statusCode: 400 });
      expect(apiKeyModel.create).not.toHaveBeenCalled();
    });

    test('revokes existing keys in the environment first when requested', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, sandbox: true });
      apiKeyModel.create.mockResolvedValue({});

      await adminService.createApiKey(1, 'label', 'sandbox', true);

      expect(apiKeyModel.revokeAllByTenantIdAndEnvironment).toHaveBeenCalledWith(1, 'sandbox');
    });

    test('does not revoke existing keys by default', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, sandbox: true });
      apiKeyModel.create.mockResolvedValue({});

      await adminService.createApiKey(1, 'label', 'sandbox');

      expect(apiKeyModel.revokeAllByTenantIdAndEnvironment).not.toHaveBeenCalled();
    });

    test('mints a token whose SHA-256 hash matches what was persisted', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, sandbox: true });
      apiKeyModel.create.mockResolvedValue({});

      const token = await adminService.createApiKey(1, 'frontend', 'sandbox');

      expect(typeof token).toBe('string');
      const expectedHash = crypto.createHash('sha256').update(token).digest('hex');
      expect(apiKeyModel.create).toHaveBeenCalledWith({
        tenantId: 1, keyHash: expectedHash, label: 'frontend', environment: 'sandbox',
      });
    });

    test('stores a null label when none is given', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, sandbox: true });
      apiKeyModel.create.mockResolvedValue({});

      await adminService.createApiKey(1, undefined, 'sandbox');

      expect(apiKeyModel.create).toHaveBeenCalledWith(expect.objectContaining({ label: null }));
    });
  });

  describe('promoteTenant', () => {
    test('rejects when the tenant does not exist', async () => {
      tenantModel.findById.mockResolvedValue(null);

      await expect(adminService.promoteTenant(1)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('rejects when the tenant is already in production', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, sandbox: false });

      await expect(adminService.promoteTenant(1)).rejects.toMatchObject({ statusCode: 409 });
      expect(tenantModel.promote).not.toHaveBeenCalled();
    });

    test('seeds production sequentials for every issuer x active document type, defaulting to 1', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, sandbox: true });
      issuerModel.findAllByTenantId.mockResolvedValue([
        { id: 5, branch_code: '001', issue_point_code: '001' },
      ]);
      issuerDocumentTypeModel.findActiveByIssuerId.mockResolvedValue(['01', '04']);
      apiKeyModel.findActiveByTenantId.mockResolvedValue([]);
      tenantModel.promote.mockResolvedValue({ id: 1, sandbox: false });

      await adminService.promoteTenant(1, [{ issuerId: 5, documentType: '01', sequential: '9' }]);

      expect(sequentialService.initialize).toHaveBeenCalledWith(5, '001', '001', '01', 9, false);
      expect(sequentialService.initialize).toHaveBeenCalledWith(5, '001', '001', '04', 1, false);
    });

    test('revokes sandbox keys and mints matching production keys, preserving labels', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, sandbox: true });
      issuerModel.findAllByTenantId.mockResolvedValue([]);
      apiKeyModel.findActiveByTenantId.mockResolvedValue([{ label: 'frontend' }, { label: 'erp' }]);
      tenantModel.promote.mockResolvedValue({ id: 1, sandbox: false });

      const result = await adminService.promoteTenant(1);

      expect(apiKeyModel.revokeAllByTenantIdAndEnvironment).toHaveBeenCalledWith(1, 'sandbox');
      expect(apiKeyModel.create).toHaveBeenCalledTimes(2);
      expect(apiKeyModel.create).toHaveBeenCalledWith(expect.objectContaining({ label: 'frontend', environment: 'production' }));
      expect(apiKeyModel.create).toHaveBeenCalledWith(expect.objectContaining({ label: 'erp', environment: 'production' }));
      expect(result.apiKeys).toEqual([
        { label: 'frontend', apiKey: expect.any(String) },
        { label: 'erp', apiKey: expect.any(String) },
      ]);
      expect(tenantModel.promote).toHaveBeenCalledWith(1);
    });

    test('returns no apiKeys when the tenant had none active in sandbox', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, sandbox: true });
      issuerModel.findAllByTenantId.mockResolvedValue([]);
      apiKeyModel.findActiveByTenantId.mockResolvedValue([]);
      tenantModel.promote.mockResolvedValue({ id: 1, sandbox: false });

      const result = await adminService.promoteTenant(1);

      expect(result).toEqual({ apiKeys: [] });
    });
  });

  describe('revokeApiKey', () => {
    test('rejects when the key does not exist', async () => {
      apiKeyModel.revoke.mockResolvedValue(null);

      await expect(adminService.revokeApiKey(1)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('revokes the key and returns the row', async () => {
      const revokedAt = new Date('2026-01-01');
      apiKeyModel.revoke.mockResolvedValue({ id: 1, revoked_at: revokedAt });

      const result = await adminService.revokeApiKey(1);

      expect(apiKeyModel.revoke).toHaveBeenCalledWith(1);
      expect(result).toEqual({ id: 1, revoked_at: revokedAt });
    });
  });

  describe('renewIssuerCertificate', () => {
    test('rejects when the issuer does not exist', async () => {
      issuerModel.findById.mockResolvedValue(null);

      await expect(adminService.renewIssuerCertificate(1, Buffer.from('x'), 'pw'))
        .rejects.toMatchObject({ statusCode: 404, code: 'ISSUER_NOT_FOUND' });
    });

    test('parses the new certificate, encrypts the key, and updates the issuer', async () => {
      issuerModel.findById.mockResolvedValue({ id: 1, tenant_id: 5 });
      const certExpiry = new Date('2031-01-01');
      certificateService.parseCertificate.mockReturnValue({
        privateKeyPem: 'new-pk', certPem: 'new-cert', certFingerprint: 'new-fp', certExpiry,
      });
      cryptoService.encrypt.mockReturnValue('new-encrypted-pk');
      issuerModel.updateCertificate.mockResolvedValue({ cert_fingerprint: 'new-fp', cert_expiry: certExpiry });

      const result = await adminService.renewIssuerCertificate(1, Buffer.from('p12'), 'pw');

      expect(certificateService.parseCertificate).toHaveBeenCalledWith(expect.any(Buffer), 'pw');
      expect(cryptoService.encrypt).toHaveBeenCalledWith('new-pk');
      expect(issuerModel.updateCertificate).toHaveBeenCalledWith(1, 5, {
        encryptedPrivateKey: 'new-encrypted-pk', certificatePem: 'new-cert', certFingerprint: 'new-fp', certExpiry,
      });
      expect(result).toEqual({ certFingerprint: 'new-fp', certExpiry });
    });

    test('passes an empty password to parseCertificate when none is supplied', async () => {
      issuerModel.findById.mockResolvedValue({ id: 1, tenant_id: 5 });
      certificateService.parseCertificate.mockReturnValue({ privateKeyPem: 'pk', certPem: 'cert', certFingerprint: 'fp', certExpiry: new Date() });
      cryptoService.encrypt.mockReturnValue('enc');
      issuerModel.updateCertificate.mockResolvedValue({});

      await adminService.renewIssuerCertificate(1, Buffer.from('p12'), undefined);

      expect(certificateService.parseCertificate).toHaveBeenCalledWith(expect.any(Buffer), '');
    });
  });
});
