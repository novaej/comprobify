jest.mock('../../../src/models/webhook-endpoint.model');

const webhookEndpointModel = require('../../../src/models/webhook-endpoint.model');
const webhookEndpointService = require('../../../src/services/webhook-endpoint.service');

const HEX_64 = /^[0-9a-f]{64}$/;

describe('WebhookEndpointService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
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
      webhookEndpointModel.countActiveByTenantId.mockResolvedValue(1); // GROWTH allows 5
      webhookEndpointModel.create.mockResolvedValue({
        id: 10, url: 'https://example.com/hook', event_types: [], active: true,
        created_at: new Date(), updated_at: new Date(),
      });

      const result = await webhookEndpointService.create(1, 'GROWTH', 'https://example.com/hook');

      expect(webhookEndpointModel.create).toHaveBeenCalled();
      expect(result.endpoint.id).toBe(10);
    });

    test('generates a 64-char hex secret, creates the endpoint with default eventTypes, and returns the secret once', async () => {
      webhookEndpointModel.countActiveByTenantId.mockResolvedValue(0);
      webhookEndpointModel.create.mockResolvedValue({
        id: 10, url: 'https://example.com/hook', event_types: [], active: true,
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
        id: 10, url: 'https://example.com/hook', eventTypes: [], active: true,
        createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
      });
      expect(result.endpoint.secret).toBeUndefined();
    });

    test('passes through explicit eventTypes', async () => {
      webhookEndpointModel.countActiveByTenantId.mockResolvedValue(0);
      webhookEndpointModel.create.mockResolvedValue({
        id: 11, url: 'https://example.com/hook', event_types: ['DOCUMENT_AUTHORIZED'], active: true,
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
        { id: 10, url: 'https://a.example.com', event_types: [], active: true, created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'), secret: 'should-not-leak' },
        { id: 11, url: 'https://b.example.com', event_types: ['DOCUMENT_AUTHORIZED'], active: true, created_at: new Date('2026-01-02'), updated_at: new Date('2026-01-02'), secret: 'should-not-leak-either' },
      ]);

      const result = await webhookEndpointService.list(1);

      expect(webhookEndpointModel.findActiveByTenantId).toHaveBeenCalledWith(1);
      expect(result).toEqual([
        { id: 10, url: 'https://a.example.com', eventTypes: [], active: true, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') },
        { id: 11, url: 'https://b.example.com', eventTypes: ['DOCUMENT_AUTHORIZED'], active: true, createdAt: new Date('2026-01-02'), updatedAt: new Date('2026-01-02') },
      ]);
      expect(result[0].secret).toBeUndefined();
    });

    test('returns an empty array when the tenant has no endpoints', async () => {
      webhookEndpointModel.findActiveByTenantId.mockResolvedValue([]);

      const result = await webhookEndpointService.list(1);

      expect(result).toEqual([]);
    });
  });

  describe('update', () => {
    test('throws NotFoundError when the endpoint does not belong to the tenant', async () => {
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue(null);

      await expect(webhookEndpointService.update(1, 99, { url: 'https://new.example.com' }))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(webhookEndpointModel.update).not.toHaveBeenCalled();
    });

    test('updates the endpoint and returns the formatted result', async () => {
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue({ id: 10, url: 'https://old.example.com' });
      webhookEndpointModel.update.mockResolvedValue({
        id: 10, url: 'https://new.example.com', event_types: [], active: false,
        created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-05'),
      });

      const result = await webhookEndpointService.update(1, 10, { url: 'https://new.example.com', active: false });

      expect(webhookEndpointModel.findByIdAndTenantId).toHaveBeenCalledWith(10, 1);
      expect(webhookEndpointModel.update).toHaveBeenCalledWith(10, { url: 'https://new.example.com', active: false });
      expect(result).toEqual({
        id: 10, url: 'https://new.example.com', eventTypes: [], active: false,
        createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-05'),
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

    test('soft-deletes the endpoint by setting active=false', async () => {
      webhookEndpointModel.findByIdAndTenantId.mockResolvedValue({ id: 10, url: 'https://example.com' });
      webhookEndpointModel.update.mockResolvedValue({ id: 10, active: false });

      const result = await webhookEndpointService.deregister(1, 10);

      expect(webhookEndpointModel.update).toHaveBeenCalledWith(10, { active: false });
      expect(result).toBeUndefined();
    });
  });
});
