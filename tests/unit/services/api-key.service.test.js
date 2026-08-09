jest.mock('../../../src/models/api-key.model');

const apiKeyModel = require('../../../src/models/api-key.model');
const apiKeyService = require('../../../src/services/api-key.service');
const { ALL_SCOPES } = require('../../../src/constants/api-key-scopes');

describe('ApiKeyService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listKeys', () => {
    test('returns active keys formatted to the response shape', async () => {
      const createdAt = new Date('2026-01-01T00:00:00Z');
      const lastUsedAt = new Date('2026-08-07T12:00:00Z');
      apiKeyModel.findActiveByTenantId.mockResolvedValue([
        {
          id: '00000000-0000-0000-0000-000000000001',
          label: 'frontend-prod',
          environment: 'production',
          scopes: ALL_SCOPES,
          active: true,
          created_at: createdAt,
          revoked_at: null,
          last_used_at: lastUsedAt,
          request_count: '15832',
        },
      ]);

      const result = await apiKeyService.listKeys(7);

      expect(apiKeyModel.findActiveByTenantId).toHaveBeenCalledWith(7);
      expect(result).toEqual([
        {
          id: '00000000-0000-0000-0000-000000000001',
          label: 'frontend-prod',
          environment: 'production',
          scopes: ALL_SCOPES,
          active: true,
          createdAt: createdAt,
          revokedAt: null,
          lastUsedAt: lastUsedAt,
          requestCount: 15832,
        },
      ]);
    });

    test('casts a never-used key (BIGINT string "0", null last_used_at) to the right JSON shape', async () => {
      apiKeyModel.findActiveByTenantId.mockResolvedValue([
        {
          id: '00000000-0000-0000-0000-000000000002',
          label: 'erp-integration',
          environment: 'production',
          active: true,
          created_at: new Date('2026-04-12T09:30:00Z'),
          revoked_at: null,
          last_used_at: null,
          request_count: '0',
        },
      ]);

      const [result] = await apiKeyService.listKeys(7);

      expect(result.lastUsedAt).toBeNull();
      expect(result.requestCount).toBe(0);
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

      await expect(apiKeyService.createKey(tenant, { label: 'erp', environment: 'sandbox' }, ALL_SCOPES))
        .rejects.toMatchObject({ statusCode: 403, code: 'EMAIL_VERIFICATION_REQUIRED' });
      expect(apiKeyModel.create).not.toHaveBeenCalled();
    });

    test('rejects a production key request when the tenant has no existing production key', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.findActiveByTenantId.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000001', environment: 'sandbox' },
      ]);

      await expect(apiKeyService.createKey(tenant, { label: 'erp', environment: 'production' }, ALL_SCOPES))
        .rejects.toMatchObject({ statusCode: 403, code: 'PRODUCTION_KEY_REQUIRES_PROMOTION' });
      expect(apiKeyModel.create).not.toHaveBeenCalled();
    });

    test('allows a production key request when the tenant already has an active production key', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.findActiveByTenantId.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000001', environment: 'production' },
      ]);
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002' });

      const { token, scopes } = await apiKeyService.createKey(tenant, { label: 'erp', environment: 'production' }, ALL_SCOPES);

      expect(typeof token).toBe('string');
      expect(token).toHaveLength(64);
      expect(scopes).toEqual(ALL_SCOPES);
      expect(apiKeyModel.create).toHaveBeenCalledWith({
        tenantId: '00000000-0000-0000-0000-000000000001',
        keyHash: expect.any(String),
        label: 'erp',
        environment: 'production',
        scopes: ALL_SCOPES,
      });
    });

    test('creates a sandbox key without checking for an existing production key', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002' });

      const { token } = await apiKeyService.createKey(tenant, { label: 'mobile-app', environment: 'sandbox' }, ALL_SCOPES);

      expect(apiKeyModel.findActiveByTenantId).not.toHaveBeenCalled();
      expect(typeof token).toBe('string');
      expect(apiKeyModel.create).toHaveBeenCalledWith({
        tenantId: '00000000-0000-0000-0000-000000000001',
        keyHash: expect.any(String),
        label: 'mobile-app',
        environment: 'sandbox',
        scopes: ALL_SCOPES,
      });
    });

    test('defaults environment to sandbox and label to null when omitted', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002' });

      await apiKeyService.createKey(tenant, {}, ALL_SCOPES);

      expect(apiKeyModel.create).toHaveBeenCalledWith({
        tenantId: '00000000-0000-0000-0000-000000000001',
        keyHash: expect.any(String),
        label: null,
        environment: 'sandbox',
        scopes: ALL_SCOPES,
      });
    });

    test('hashes the returned plaintext token with sha256 for storage', async () => {
      const crypto = require('crypto');
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002' });

      const { token } = await apiKeyService.createKey(tenant, { label: 'erp', environment: 'sandbox' }, ALL_SCOPES);

      const expectedHash = crypto.createHash('sha256').update(token).digest('hex');
      expect(apiKeyModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ keyHash: expectedHash })
      );
    });

    test('passes an explicit scopes array through to storage and the response instead of defaulting', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002' });

      const { scopes } = await apiKeyService.createKey(tenant, {
        label: 'dashboard-readonly',
        environment: 'sandbox',
        scopes: ['documents:read'],
      }, ALL_SCOPES);

      expect(scopes).toEqual(['documents:read']);
      expect(apiKeyModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ scopes: ['documents:read'] })
      );
    });

    test('defaults to full access (ALL_SCOPES) when an empty scopes array is passed and the requesting key is full-access', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002' });

      const { scopes } = await apiKeyService.createKey(tenant, {
        label: 'erp',
        environment: 'sandbox',
        scopes: [],
      }, ALL_SCOPES);

      expect(scopes).toEqual(ALL_SCOPES);
    });

    // Privilege containment: a key can never mint one broader than itself.
    test('omitting scopes clones the requesting key\'s own scopes, not a blanket full-access default', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002' });

      const { scopes } = await apiKeyService.createKey(tenant, { label: 'child-key', environment: 'sandbox' }, ['keys:manage']);

      expect(scopes).toEqual(['keys:manage']);
      expect(apiKeyModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ scopes: ['keys:manage'] })
      );
    });

    test('allows minting a key with a strict subset of the requesting key\'s own scopes', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };
      apiKeyModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000002' });

      const { scopes } = await apiKeyService.createKey(tenant, {
        label: 'read-only-child',
        environment: 'sandbox',
        scopes: ['documents:read'],
      }, ['documents:read', 'documents:write', 'keys:manage']);

      expect(scopes).toEqual(['documents:read']);
    });

    test('rejects minting a key with a scope the requesting key does not itself hold', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };

      await expect(apiKeyService.createKey(tenant, {
        label: 'escalated-key',
        environment: 'sandbox',
        scopes: ['tenant:promote'],
      }, ['keys:manage']))
        .rejects.toMatchObject({ statusCode: 403, code: 'SCOPE_ESCALATION_FORBIDDEN' });
      expect(apiKeyModel.create).not.toHaveBeenCalled();
    });

    test('rejects when only some requested scopes exceed the requesting key\'s own scopes', async () => {
      const tenant = { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' };

      await expect(apiKeyService.createKey(tenant, {
        label: 'partially-escalated-key',
        environment: 'sandbox',
        scopes: ['documents:read', 'billing:manage'],
      }, ['documents:read']))
        .rejects.toMatchObject({ statusCode: 403, code: 'SCOPE_ESCALATION_FORBIDDEN' });
      expect(apiKeyModel.create).not.toHaveBeenCalled();
    });
  });

  describe('getDailyUsage', () => {
    test('throws NotFoundError when the key does not belong to the tenant', async () => {
      apiKeyModel.findByIdAndTenantId.mockResolvedValue(null);

      await expect(apiKeyService.getDailyUsage(1, 99, 30))
        .rejects.toMatchObject({ statusCode: 404 });
      expect(apiKeyModel.findDailyUsage).not.toHaveBeenCalled();
    });

    test('returns a revoked key\'s usage history too — ownership, not active status, gates access', async () => {
      apiKeyModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000099', active: false });
      apiKeyModel.findDailyUsage.mockResolvedValue([]);

      await apiKeyService.getDailyUsage(1, '00000000-0000-0000-0000-000000000099', 30);

      expect(apiKeyModel.findDailyUsage).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000099', 30);
    });

    test('maps daily rows to the response shape, casting the BIGINT string count to a number', async () => {
      apiKeyModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000099', active: true });
      apiKeyModel.findDailyUsage.mockResolvedValue([
        { usage_date: '2026-08-05', request_count: '0' },
        { usage_date: '2026-08-06', request_count: '42' },
        { usage_date: '2026-08-07', request_count: '17' },
      ]);

      const result = await apiKeyService.getDailyUsage(1, '00000000-0000-0000-0000-000000000099', 3);

      expect(apiKeyModel.findDailyUsage).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000099', 3);
      expect(result).toEqual([
        { date: '2026-08-05', requestCount: 0 },
        { date: '2026-08-06', requestCount: 42 },
        { date: '2026-08-07', requestCount: 17 },
      ]);
    });

    test('defaults days to 30 when not supplied', async () => {
      apiKeyModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000099', active: true });
      apiKeyModel.findDailyUsage.mockResolvedValue([]);

      await apiKeyService.getDailyUsage(1, '00000000-0000-0000-0000-000000000099');

      expect(apiKeyModel.findDailyUsage).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000099', 30);
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
