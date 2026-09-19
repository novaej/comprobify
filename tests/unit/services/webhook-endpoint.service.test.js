jest.mock('../../../src/models/webhook-endpoint.model');
jest.mock('../../../src/models/tenant.model');

const webhookEndpointModel = require('../../../src/models/webhook-endpoint.model');
const tenantModel = require('../../../src/models/tenant.model');
const webhookEndpointService = require('../../../src/services/webhook-endpoint.service');

const HEX_64 = /^[0-9a-f]{64}$/;

describe('WebhookEndpointService', () => {
  beforeEach(() => {
    tenantModel.findById.mockResolvedValue({ id: 1, status: 'ACTIVE' });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    test('rejects an unverified (PENDING_VERIFICATION) tenant — e.g. one demoted by account recovery', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, status: 'PENDING_VERIFICATION' });

      await expect(webhookEndpointService.create(1, 'GROWTH', 'https://example.com/hook'))
        .rejects.toMatchObject({ statusCode: 403, code: 'EMAIL_VERIFICATION_REQUIRED' });
      expect(webhookEndpointModel.create).not.toHaveBeenCalled();
    });

    test('rejects an unknown subscription tier', async () => {
      await expect(webhookEndpointService.create(1, 'NOT_A_TIER', 'https://example.com/hook'))
        .rejects.toMatchObject({ statusCode: 400 });
      expect(webhookEndpointModel.countActiveByTenantId).not.toHaveBeenCalled();
      expect(webhookEndpointModel.create).not.toHaveBeenCalled();
    });

    test('rejects when the tenant has reached their tier webhook endpoint limit', async () => {
      webhookEndpointModel.countActiveByTenantId.mockResolvedValue(1);

      await expect(webhookEndpointService.create(1, 'FREE', 'https://example.com/hook'))
        .rejects.toMatchObject({ statusCode: 402, code: 'WEBHOOK_ENDPOINT_LIMIT_REACHED' });
      expect(webhookEndpointModel.create).not.toHaveBeenCalled();
    });

    test('allows creating up to (but not exceeding) the tier limit', async () => {
      webhookEndpointModel.countActiveByTenantId.mockResolvedValue(1); // GROWTH's own pool is 5
      webhookEndpointModel.create.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', url: 'https://example.com/hook', event_types: [], active: true,
        created_at: new Date(), updated_at: new Date(),
      });

      const result = await webhookEndpointService.create(1, 'GROWTH', 'https://example.com/hook');

      expect(webhookEndpointModel.create).toHaveBeenCalled();
      expect(result.endpoint.id).toBe('00000000-0000-0000-0000-000000000010');
    });

    test('generates a 64-char hex secret, creates the endpoint with default eventTypes, and returns the secret once', async () => {
      webhookEndpointModel.countActiveByTenantId.mockResolvedValue(0);
      webhookEndpointModel.create.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', url: 'https://example.com/hook', event_types: [], active: true,
        created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
      });

      const result = await webhookEndpointService.create(1, 'STARTER', 'https://example.com/hook');

      const [createArgs] = webhookEndpointModel.create.mock.calls[0];
      expect(createArgs.tenantId).toBe(1);
      expect(createArgs.url).toBe('https://example.com/hook');
      expect(createArgs.eventTypes).toEqual([]);
      expect(createArgs.secret).toMatch(HEX_64);

      expect(result.secret).toMatch(HEX_64);
      expect(result.secret).toBe(createArgs.secret);
      expect(result.endpoint).toEqual({
        id: '00000000-0000-0000-0000-000000000010', url: 'https://example.com/hook', eventTypes: [], active: true,
        createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), isReserved: false,
      });
      expect(result.endpoint.secret).toBeUndefined();
    });

    test('passes through explicit eventTypes', async () => {
      webhookEndpointModel.countActiveByTenantId.mockResolvedValue(0);
      webhookEndpointModel.create.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000011', url: 'https://example.com/hook', event_types: ['DOCUMENT_AUTHORIZED'], active: true,
        created_at: new Date(), updated_at: new Date(),
      });

      await webhookEndpointService.create(1, 'STARTER', 'https://example.com/hook', ['DOCUMENT_AUTHORIZED']);

      const [createArgs] = webhookEndpointModel.create.mock.calls[0];
      expect(createArgs.eventTypes).toEqual(['DOCUMENT_AUTHORIZED']);
    });
  });

  describe('list', () => {
    test('returns formatted endpoints without secrets', async () => {
      webhookEndpointModel.findActiveByTenantId.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000010', url: 'https://a.example.com', event_types: [], active: true, created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'), secret: 'should-not-leak' },
        { id: '00000000-0000-0000-0000-000000000011', url: 'https://b.example.com', event_types: ['DOCUMENT_AUTHORIZED'], active: true, created_at: new Date('2026-01-02'), updated_at: new Date('2026-01-02'), secret: 'should-not-leak-either' },
      ]);

      const result = await webhookEndpointService.list(1, 'STARTER');

      expect(webhookEndpointModel.findActiveByTenantId).toHaveBeenCalledWith(1);
      expect(result).toEqual({
        endpoints: [
          { id: '00000000-0000-0000-0000-000000000010', url: 'https://a.example.com', eventTypes: [], active: true, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), isReserved: false },
          { id: '00000000-0000-0000-0000-000000000011', url: 'https://b.example.com', eventTypes: ['DOCUMENT_AUTHORIZED'], active: true, createdAt: new Date('2026-01-02'), updatedAt: new Date('2026-01-02'), isReserved: false },
        ],
        limit: { max: 2, used: 2 }, // STARTER's own self-service pool — reserved endpoints are excluded, not added on top
      });
      expect(result.endpoints[0].secret).toBeUndefined();
    });

    test('returns an empty array and a genuinely zero limit for a FREE tenant', async () => {
      webhookEndpointModel.findActiveByTenantId.mockResolvedValue([]);

      const result = await webhookEndpointService.list(1, 'FREE');

      expect(result).toEqual({ endpoints: [], limit: { max: 0, used: 0 } });
    });
  });

  describe('update', () => {
    test('rejects retargeting url or eventTypes for an unverified tenant, but still allows disabling', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, status: 'PENDING_VERIFICATION' });
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', url: 'https://old.example.com' });

      await expect(webhookEndpointService.update(1, 10, { url: 'https://attacker.example.com' }))
        .rejects.toMatchObject({ statusCode: 403, code: 'EMAIL_VERIFICATION_REQUIRED' });
      await expect(webhookEndpointService.update(1, 10, { eventTypes: ['DOCUMENT_AUTHORIZED'] }))
        .rejects.toMatchObject({ statusCode: 403, code: 'EMAIL_VERIFICATION_REQUIRED' });
      expect(webhookEndpointModel.update).not.toHaveBeenCalled();

      webhookEndpointModel.update.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', url: 'https://old.example.com', event_types: [], active: false,
        created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-05'),
      });
      await expect(webhookEndpointService.update(1, 10, { active: false })).resolves.toMatchObject({ active: false });
    });

    test('treats the controller\'s undefined-valued keys as omitted: toggling active on a reserved endpoint via PATCH works', async () => {
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', url: 'https://old.example.com', is_reserved: true });
      webhookEndpointModel.update.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', url: 'https://old.example.com', event_types: [], active: false,
        created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-05'), is_reserved: true,
      });

      // exactly the shape webhook-endpoint.controller.js builds from { active: false }
      const result = await webhookEndpointService.update(1, 10, { url: undefined, eventTypes: undefined, active: false });

      expect(result.active).toBe(false);
      expect(webhookEndpointModel.update).toHaveBeenCalled();
    });

    test('still blocks a real url change on a reserved endpoint when the other keys are undefined', async () => {
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', url: 'https://old.example.com', is_reserved: true });

      await expect(webhookEndpointService.update(1, 10, { url: 'https://new.example.com', eventTypes: undefined, active: undefined }))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    test('throws NotFoundError when the endpoint does not belong to the tenant', async () => {
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue(null);

      await expect(webhookEndpointService.update(1, 99, { url: 'https://new.example.com' }))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(webhookEndpointModel.update).not.toHaveBeenCalled();
    });

    test('throws NotFoundError retargeting url on a reserved endpoint — a tenant must not redirect comprobify-web\'s own notification receiver', async () => {
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', url: 'https://old.example.com', is_reserved: true });

      await expect(webhookEndpointService.update(1, 10, { url: 'https://new.example.com' }))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(webhookEndpointModel.update).not.toHaveBeenCalled();
    });

    test('throws NotFoundError changing eventTypes on a reserved endpoint', async () => {
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', url: 'https://old.example.com', is_reserved: true });

      await expect(webhookEndpointService.update(1, 10, { eventTypes: ['DOCUMENT_AUTHORIZED'] }))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(webhookEndpointModel.update).not.toHaveBeenCalled();
    });

    test('allows toggling active on a reserved endpoint — it\'s a delivery switch, not a credential, unlike an API key', async () => {
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', url: 'https://old.example.com', is_reserved: true });
      webhookEndpointModel.update.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', url: 'https://old.example.com', event_types: [], active: false,
        created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-05'), is_reserved: true,
      });

      const result = await webhookEndpointService.update(1, 10, { active: false });

      expect(webhookEndpointModel.update).toHaveBeenCalledWith(10, { active: false });
      expect(result.active).toBe(false);
      expect(result.isReserved).toBe(true);
    });

    test('updates the endpoint and returns the formatted result', async () => {
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', url: 'https://old.example.com' });
      webhookEndpointModel.update.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', url: 'https://new.example.com', event_types: [], active: false,
        created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-05'),
      });

      const result = await webhookEndpointService.update(1, 10, { url: 'https://new.example.com', active: false });

      expect(webhookEndpointModel.findByIdAndTenantId).toHaveBeenCalledWith(10, 1);
      expect(webhookEndpointModel.update).toHaveBeenCalledWith(10, { url: 'https://new.example.com', active: false });
      expect(result).toEqual({
        id: '00000000-0000-0000-0000-000000000010', url: 'https://new.example.com', eventTypes: [], active: false,
        createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-05'), isReserved: false,
      });
    });
  });

  describe('deregister', () => {
    test('throws NotFoundError when the endpoint does not belong to the tenant', async () => {
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue(null);

      await expect(webhookEndpointService.deregister(1, 99))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(webhookEndpointModel.update).not.toHaveBeenCalled();
    });

    test('deregisters a reserved endpoint too — active isn\'t a credential the way an API key is', async () => {
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', url: 'https://example.com', is_reserved: true });
      webhookEndpointModel.update.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', active: false });

      await webhookEndpointService.deregister(1, 10);

      expect(webhookEndpointModel.update).toHaveBeenCalledWith(10, { active: false });
    });

    test('soft-deletes the endpoint by setting active=false', async () => {
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', url: 'https://example.com' });
      webhookEndpointModel.update.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', active: false });

      const result = await webhookEndpointService.deregister(1, 10);

      expect(webhookEndpointModel.update).toHaveBeenCalledWith(10, { active: false });
      expect(result).toBeUndefined();
    });
  });
});
