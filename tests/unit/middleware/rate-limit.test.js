jest.mock('../../../src/services/redis.service');

const redisService = require('../../../src/services/redis.service');
const { writeLimiter, readLimiter, buildStore } = require('../../../src/middleware/rate-limit');

describe('rate-limit middleware', () => {
  describe('writeLimiter', () => {
    test('should export writeLimiter as a middleware function', () => {
      expect(typeof writeLimiter).toBe('function');
    });
  });

  describe('readLimiter', () => {
    test('should export readLimiter as a middleware function', () => {
      expect(typeof readLimiter).toBe('function');
    });
  });

  describe('buildStore', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    test('returns undefined (in-memory fallback) when no Redis client is configured', () => {
      redisService.getClient.mockReturnValue(null);

      expect(buildStore('rl:write:')).toBeUndefined();
    });

    test('returns a RedisStore scoped to the given prefix when a Redis client is configured', () => {
      redisService.getClient.mockReturnValue({ call: jest.fn() });

      const store = buildStore('rl:write:');

      expect(store).toBeDefined();
      expect(store.prefix).toBe('rl:write:');
    });
  });
});
