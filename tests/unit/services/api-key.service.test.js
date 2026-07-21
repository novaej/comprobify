jest.mock('../../../src/models/api-key.model');

const apiKeyModel = require('../../../src/models/api-key.model');
const apiKeyService = require('../../../src/services/api-key.service');

describe('ApiKeyService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listKeys', () => {
    test('returns active keys formatted to the response shape', async () => {
      const createdAt = new Date('2026-01-01T00:00:00Z');
      apiKeyModel.findActiveByTenantId.mockResolvedValue([
        {
          id: '00000000-0000-0000-0000-000000000001',
          label: 'frontend-prod',
          environment: 'production',
          active: true,
          created_at: createdAt,
          revoked_at: null,
        },
      ]);

      const result = await apiKeyService.listKeys(7);

      expect(apiKeyModel.findActiveByTenantId).toHaveBeenCalledWith(7);
      expect(result).toEqual([
        {
          id: '00000000-0000-0000-0000-000000000001',
          label: 'frontend-prod',
          environment: 'production',
          active: true,
          createdAt: createdAt,
          revokedAt: null,
        },
      ]);
    });

    test('returns an empty array when the tenant has no active keys', async () => {
      apiKeyModel.findActiveByTenantId.mockResolvedValue([]);

      const result = await apiKeyService.listKeys(7);

      expect(result).toEqual([]);
    });
  });

  describe('createKey', () => {
    test('rejects when the tenant has not verified their email', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'PENDING_VERIFICATION' };

      await expect(apiKeyService.createKey(tenant, { label: 'erp', environment: 'sandbox' }))
        .rejects.toMatchObject({ statusCode: 403, code: 'EMAIL_VERIFICATION_REQUIRED' });
      expect(apiKeyModel.create).not.toHaveBeenCalled();
    });

    test('rejects a production key request when the tenant has no existing production key', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.findActiveByTenantId.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000001', environment: 'sandbox' },
      ]);

      await expect(apiKeyService.createKey(tenant, { label: 'erp', environment: 'production' }))
        .rejects.toMatchObject({ statusCode: 403, code: 'PRODUCTION_KEY_REQUIRES_PROMOTION' });
      expect(apiKeyModel.create).not.toHaveBeenCalled();
    });

    test('allows a production key request when the tenant already has an active production key', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.findActiveByTenantId.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000001', environment: 'production' },
      ]);
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002' });

      const token = await apiKeyService.createKey(tenant, { label: 'erp', environment: 'production' });

      expect(typeof token).toBe('string');
      expect(token).toHaveLength(64);
      expect(apiKeyModel.create).toHaveBeenCalledWith({
        tenantId: '00000000-0000-0000-0000-000000000001',
        keyHash: expect.any(String),
        label: 'erp',
        environment: 'production',
      });
    });

    test('creates a sandbox key without checking for an existing production key', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002' });

      const token = await apiKeyService.createKey(tenant, { label: 'mobile-app', environment: 'sandbox' });

      expect(apiKeyModel.findActiveByTenantId).not.toHaveBeenCalled();
      expect(typeof token).toBe('string');
      expect(apiKeyModel.create).toHaveBeenCalledWith({
        tenantId: '00000000-0000-0000-0000-000000000001',
        keyHash: expect.any(String),
        label: 'mobile-app',
        environment: 'sandbox',
      });
    });

    test('defaults environment to sandbox and label to null when omitted', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002' });

      await apiKeyService.createKey(tenant, {});

      expect(apiKeyModel.create).toHaveBeenCalledWith({
        tenantId: '00000000-0000-0000-0000-000000000001',
        keyHash: expect.any(String),
        label: null,
        environment: 'sandbox',
      });
    });

    test('hashes the returned plaintext token with sha256 for storage', async () => {
      const crypto = require('crypto');
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002' });

      const token = await apiKeyService.createKey(tenant, { label: 'erp', environment: 'sandbox' });

      const expectedHash = crypto.createHash('sha256').update(token).digest('hex');
      expect(apiKeyModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ keyHash: expectedHash })
      );
    });
  });

  describe('revokeKey', () => {
    test('throws NotFoundError when the key does not exist for the tenant', async () => {
      apiKeyModel.findByIdAndTenantId.mockResolvedValue(null);

      await expect(apiKeyService.revokeKey(1, 99, 5))
        .rejects.toMatchObject({ statusCode: 404 });
      expect(apiKeyModel.revoke).not.toHaveBeenCalled();
    });

    test('throws NotFoundError when the key is already inactive', async () => {
      apiKeyModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000099', active: false });

      await expect(apiKeyService.revokeKey(1, 99, 5))
        .rejects.toMatchObject({ statusCode: 404 });
      expect(apiKeyModel.revoke).not.toHaveBeenCalled();
    });

    test('rejects revoking the key currently used to authenticate the request', async () => {
      apiKeyModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000005', active: true });

      await expect(apiKeyService.revokeKey(1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000005'))
        .rejects.toMatchObject({ statusCode: 400, code: 'SELF_REVOCATION_FORBIDDEN' });
      expect(apiKeyModel.revoke).not.toHaveBeenCalled();
    });

    test('revokes a different active key belonging to the tenant', async () => {
      apiKeyModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000099', active: true });
      apiKeyModel.revoke.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000099', active: false });

      await apiKeyService.revokeKey(1, '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000005');

      expect(apiKeyModel.findByIdAndTenantId).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000099', 1);
      expect(apiKeyModel.revoke).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000099');
    });
  });
});
