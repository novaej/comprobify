const mockOn = jest.fn();
const MockRedis = jest.fn().mockImplementation(() => ({ on: mockOn }));

jest.mock('ioredis', () => MockRedis);

describe('redis.service', () => {
  // config/index.js and redis.service.js are both re-required fresh after
  // resetModules, so the config mutation below and the module-level `client`
  // singleton inside redis.service.js never leak between tests.
  beforeEach(() => {
    jest.resetModules();
    MockRedis.mockClear();
    mockOn.mockClear();
  });

  test('getClient returns null when REDIS_URL is not configured', () => {
    const config = require('../../../src/config');
    config.redis.url = '';
    const redisService = require('../../../src/services/redis.service');

    expect(redisService.getClient()).toBeNull();
    expect(MockRedis).not.toHaveBeenCalled();
  });

  test('getClient constructs an ioredis client with the configured URL', () => {
    const config = require('../../../src/config');
    config.redis.url = 'redis://redis:6379';
    const redisService = require('../../../src/services/redis.service');

    const client = redisService.getClient();

    expect(client).not.toBeNull();
    expect(MockRedis).toHaveBeenCalledWith(
      'redis://redis:6379',
      expect.objectContaining({ maxRetriesPerRequest: 1, enableOfflineQueue: false })
    );
  });

  test('getClient returns the same singleton instance across calls', () => {
    const config = require('../../../src/config');
    config.redis.url = 'redis://redis:6379';
    const redisService = require('../../../src/services/redis.service');

    const first = redisService.getClient();
    const second = redisService.getClient();

    expect(first).toBe(second);
    expect(MockRedis).toHaveBeenCalledTimes(1);
  });
});
