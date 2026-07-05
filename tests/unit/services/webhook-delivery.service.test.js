const crypto = require('crypto');

jest.mock('../../../src/models/webhook-endpoint.model');
jest.mock('../../../src/models/webhook-delivery.model');
jest.mock('../../../src/models/notification.model');

const webhookEndpointModel = require('../../../src/models/webhook-endpoint.model');
const webhookDeliveryModel = require('../../../src/models/webhook-delivery.model');
const notificationModel = require('../../../src/models/notification.model');
const webhookDeliveryService = require('../../../src/services/webhook-delivery.service');

describe('WebhookDeliveryService', () => {
  afterEach(() => {
    // resetAllMocks (not clearAllMocks) so a mockResolvedValue/mockRejectedValue
    // set in one test never leaks its implementation into the next.
    jest.resetAllMocks();
    if (global.fetch && global.fetch.mockRestore) global.fetch.mockRestore();
    delete global.fetch;
  });

  describe('computeSignature', () => {
    test('produces a stable, known HMAC-SHA256 signature for a given secret/timestamp/body', () => {
      const secret = 'my-webhook-secret';
      const timestamp = 1700000000;
      const rawBody = '{"event":"DOCUMENT_AUTHORIZED"}';

      const expected = `sha256=${crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex')}`;

      expect(webhookDeliveryService.computeSignature(secret, timestamp, rawBody)).toBe(expected);
    });

    test('changes when the body changes', () => {
      const secret = 'my-webhook-secret';
      const timestamp = 1700000000;

      const sig1 = webhookDeliveryService.computeSignature(secret, timestamp, '{"a":1}');
      const sig2 = webhookDeliveryService.computeSignature(secret, timestamp, '{"a":2}');

      expect(sig1).not.toBe(sig2);
    });

    test('changes when the secret changes', () => {
      const timestamp = 1700000000;
      const rawBody = '{"a":1}';

      const sig1 = webhookDeliveryService.computeSignature('secret-one', timestamp, rawBody);
      const sig2 = webhookDeliveryService.computeSignature('secret-two', timestamp, rawBody);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('fanOut', () => {
    const notification = {
      id: 100,
      tenant_id: 1,
      type: 'DOCUMENT_AUTHORIZED',
      severity: 'INFO',
      title: 'Invoice authorized',
      message: 'Invoice was authorized',
      metadata: null,
      issuer_id: 5,
      read_at: null,
      expires_at: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
    };

    test('does nothing when the endpoint query fails (swallows the error)', async () => {
      webhookEndpointModel.findSubscribedByTenantIdAndType.mockRejectedValue(new Error('DB down'));

      await expect(webhookDeliveryService.fanOut(notification)).resolves.toBeUndefined();

      expect(webhookDeliveryModel.create).not.toHaveBeenCalled();
    });

    test('does nothing when there are no subscribed endpoints', async () => {
      webhookEndpointModel.findSubscribedByTenantIdAndType.mockResolvedValue([]);

      await webhookDeliveryService.fanOut(notification);

      expect(webhookDeliveryModel.create).not.toHaveBeenCalled();
    });

    test('delivers to a subscribed endpoint and marks success on a 2xx response', async () => {
      webhookEndpointModel.findSubscribedByTenantIdAndType.mockResolvedValue([
        { id: 7, url: 'https://example.com/hook', secret: 'sekret' },
      ]);
      webhookDeliveryModel.create.mockResolvedValue({ id: 55, attempt_count: 0 });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"received":true}'),
      });

      await webhookDeliveryService.fanOut(notification);

      expect(webhookEndpointModel.findSubscribedByTenantIdAndType).toHaveBeenCalledWith(1, 'DOCUMENT_AUTHORIZED');
      expect(webhookDeliveryModel.create).toHaveBeenCalledWith({
        notificationId: 100,
        webhookId: 7,
        tenantId: 1,
      });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/hook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Comprobify-Signature': expect.stringMatching(/^sha256=/),
            'X-Comprobify-Timestamp': expect.any(String),
            'User-Agent': 'Comprobify-Webhook/1.0',
          }),
        })
      );
      expect(webhookDeliveryModel.markSuccess).toHaveBeenCalledWith(55, {
        statusCode: 200,
        body: '{"received":true}',
      });
      expect(webhookDeliveryModel.markFailure).not.toHaveBeenCalled();
    });

    test('marks failure when the endpoint responds with a non-2xx status', async () => {
      webhookEndpointModel.findSubscribedByTenantIdAndType.mockResolvedValue([
        { id: 7, url: 'https://example.com/hook', secret: 'sekret' },
      ]);
      webhookDeliveryModel.create.mockResolvedValue({ id: 55, attempt_count: 0 });
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await webhookDeliveryService.fanOut(notification);

      expect(webhookDeliveryModel.markFailure).toHaveBeenCalledWith(55, 0, {
        ok: false,
        statusCode: 500,
        body: 'Internal Server Error',
      });
      expect(webhookDeliveryModel.markSuccess).not.toHaveBeenCalled();
    });

    test('marks failure with a captured error message when fetch throws (network error)', async () => {
      webhookEndpointModel.findSubscribedByTenantIdAndType.mockResolvedValue([
        { id: 7, url: 'https://example.com/hook', secret: 'sekret' },
      ]);
      webhookDeliveryModel.create.mockResolvedValue({ id: 55, attempt_count: 0 });
      global.fetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

      await webhookDeliveryService.fanOut(notification);

      expect(webhookDeliveryModel.markFailure).toHaveBeenCalledWith(55, 0, {
        ok: false,
        error: 'connect ECONNREFUSED',
      });
    });

    test('delivers to every subscribed endpoint independently', async () => {
      webhookEndpointModel.findSubscribedByTenantIdAndType.mockResolvedValue([
        { id: 7, url: 'https://example.com/hook-a', secret: 'sekret-a' },
        { id: 8, url: 'https://example.com/hook-b', secret: 'sekret-b' },
      ]);
      webhookDeliveryModel.create
        .mockResolvedValueOnce({ id: 55, attempt_count: 0 })
        .mockResolvedValueOnce({ id: 56, attempt_count: 0 });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('ok'),
      });

      await webhookDeliveryService.fanOut(notification);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(webhookDeliveryModel.markSuccess).toHaveBeenCalledWith(55, expect.any(Object));
      expect(webhookDeliveryModel.markSuccess).toHaveBeenCalledWith(56, expect.any(Object));
    });

    test('skips an endpoint whose delivery row creation fails, but continues to the next one', async () => {
      webhookEndpointModel.findSubscribedByTenantIdAndType.mockResolvedValue([
        { id: 7, url: 'https://example.com/hook-a', secret: 'sekret-a' },
        { id: 8, url: 'https://example.com/hook-b', secret: 'sekret-b' },
      ]);
      webhookDeliveryModel.create
        .mockRejectedValueOnce(new Error('insert failed'))
        .mockResolvedValueOnce({ id: 56, attempt_count: 0 });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('ok'),
      });

      await webhookDeliveryService.fanOut(notification);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/hook-b', expect.any(Object));
    });

    test('swallows an error thrown while persisting the delivery result', async () => {
      webhookEndpointModel.findSubscribedByTenantIdAndType.mockResolvedValue([
        { id: 7, url: 'https://example.com/hook', secret: 'sekret' },
      ]);
      webhookDeliveryModel.create.mockResolvedValue({ id: 55, attempt_count: 0 });
      webhookDeliveryModel.markSuccess.mockRejectedValue(new Error('update failed'));
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('ok'),
      });

      await expect(webhookDeliveryService.fanOut(notification)).resolves.toBeUndefined();
    });
  });

  describe('processDueRetries', () => {
    test('returns zeroed counters when there are no due retries', async () => {
      webhookDeliveryModel.findDueRetries.mockResolvedValue([]);

      const result = await webhookDeliveryService.processDueRetries();

      expect(webhookDeliveryModel.findDueRetries).toHaveBeenCalledWith(100);
      expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0, exhausted: 0 });
    });

    test('skips a due retry whose notification lookup fails', async () => {
      webhookDeliveryModel.findDueRetries.mockResolvedValue([
        { id: 1, notification_id: 100, url: 'https://example.com/hook', secret: 's', attempt_count: 1 },
      ]);
      notificationModel.findById.mockRejectedValue(new Error('DB down'));

      const result = await webhookDeliveryService.processDueRetries();

      expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 0, exhausted: 0 });
    });

    test('skips a due retry whose notification no longer exists', async () => {
      webhookDeliveryModel.findDueRetries.mockResolvedValue([
        { id: 1, notification_id: 100, url: 'https://example.com/hook', secret: 's', attempt_count: 1 },
      ]);
      notificationModel.findById.mockResolvedValue(null);

      const result = await webhookDeliveryService.processDueRetries();

      expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 0, exhausted: 0 });
    });

    test('counts a successful retry', async () => {
      webhookDeliveryModel.findDueRetries.mockResolvedValue([
        { id: 1, notification_id: 100, url: 'https://example.com/hook', secret: 's', attempt_count: 1 },
      ]);
      notificationModel.findById.mockResolvedValue({
        id: 100, tenant_id: 1, type: 'DOCUMENT_AUTHORIZED', created_at: new Date('2026-01-01T00:00:00Z'),
      });
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('ok') });

      const result = await webhookDeliveryService.processDueRetries();

      expect(webhookDeliveryModel.markSuccess).toHaveBeenCalledWith(1, { statusCode: 200, body: 'ok' });
      expect(result).toEqual({ attempted: 1, succeeded: 1, failed: 0, exhausted: 0 });
    });

    test('counts a failed retry that still has attempts remaining (RETRYING)', async () => {
      webhookDeliveryModel.findDueRetries.mockResolvedValue([
        { id: 1, notification_id: 100, url: 'https://example.com/hook', secret: 's', attempt_count: 1 },
      ]);
      notificationModel.findById.mockResolvedValue({
        id: 100, tenant_id: 1, type: 'DOCUMENT_AUTHORIZED', created_at: new Date('2026-01-01T00:00:00Z'),
      });
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('err') });
      webhookDeliveryModel.markFailure.mockResolvedValue({ id: 1, status: 'RETRYING' });

      const result = await webhookDeliveryService.processDueRetries();

      expect(webhookDeliveryModel.markFailure).toHaveBeenCalledWith(1, 1, { ok: false, statusCode: 500, body: 'err' });
      expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 1, exhausted: 0 });
    });

    test('counts an exhausted retry (final failure -> FAILED) separately from a retryable one', async () => {
      webhookDeliveryModel.findDueRetries.mockResolvedValue([
        { id: 1, notification_id: 100, url: 'https://example.com/hook', secret: 's', attempt_count: 2 },
      ]);
      notificationModel.findById.mockResolvedValue({
        id: 100, tenant_id: 1, type: 'DOCUMENT_AUTHORIZED', created_at: new Date('2026-01-01T00:00:00Z'),
      });
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('err') });
      webhookDeliveryModel.markFailure.mockResolvedValue({ id: 1, status: 'FAILED' });

      const result = await webhookDeliveryService.processDueRetries();

      expect(webhookDeliveryModel.markFailure).toHaveBeenCalledWith(1, 2, { ok: false, statusCode: 500, body: 'err' });
      expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 0, exhausted: 1 });
    });

    test('swallows an error thrown while persisting a retry result and does not count it', async () => {
      webhookDeliveryModel.findDueRetries.mockResolvedValue([
        { id: 1, notification_id: 100, url: 'https://example.com/hook', secret: 's', attempt_count: 1 },
      ]);
      notificationModel.findById.mockResolvedValue({
        id: 100, tenant_id: 1, type: 'DOCUMENT_AUTHORIZED', created_at: new Date('2026-01-01T00:00:00Z'),
      });
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('ok') });
      webhookDeliveryModel.markSuccess.mockRejectedValue(new Error('update failed'));

      const result = await webhookDeliveryService.processDueRetries();

      expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 0, exhausted: 0 });
    });

    test('processes multiple due retries and aggregates counters correctly', async () => {
      webhookDeliveryModel.findDueRetries.mockResolvedValue([
        { id: 1, notification_id: 100, url: 'https://example.com/hook-a', secret: 's', attempt_count: 0 },
        { id: 2, notification_id: 101, url: 'https://example.com/hook-b', secret: 's', attempt_count: 2 },
      ]);
      notificationModel.findById.mockImplementation((id) => Promise.resolve({
        id, tenant_id: 1, type: 'DOCUMENT_AUTHORIZED', created_at: new Date('2026-01-01T00:00:00Z'),
      }));
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('err') });
      webhookDeliveryModel.markFailure
        .mockResolvedValueOnce({ id: 1, status: 'RETRYING' })
        .mockResolvedValueOnce({ id: 2, status: 'FAILED' });

      const result = await webhookDeliveryService.processDueRetries();

      expect(result).toEqual({ attempted: 2, succeeded: 0, failed: 1, exhausted: 1 });
    });
  });
});
