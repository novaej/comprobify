jest.mock('../../../src/services/redis.service');

const redisService = require('../../../src/services/redis.service');
const {
  writeLimiter, readLimiter, registerLimiter, recoverLimiter, resendVerificationLimiter, buildStore, keyGenerator,
} = require('../../../src/middleware/rate-limit');

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

  describe('account-lifecycle limiters', () => {
    test('register, recover, and resend-verification are independent middleware instances', () => {
      expect(typeof registerLimiter).toBe('function');
      expect(typeof recoverLimiter).toBe('function');
      expect(typeof resendVerificationLimiter).toBe('function');
      expect(registerLimiter).not.toBe(recoverLimiter);
      expect(recoverLimiter).not.toBe(resendVerificationLimiter);
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

  describe('keyGenerator', () => {
    test('uses req.keyHash when present, ignoring the IP', () => {
      expect(keyGenerator({ keyHash: 'abc123', ip: '1.2.3.4' })).toBe('abc123');
    });

    // Regression test: keyGenerator used to call ipKeyGenerator(req) — the
    // whole request object, not req.ip — collapsing every distinct IP onto
    // one shared bucket. See Common Mistake #44.
    test('falls back to a distinct key per IP when there is no keyHash', () => {
      const keyA = keyGenerator({ ip: '1.2.3.4' });
      const keyB = keyGenerator({ ip: '5.6.7.8' });

      expect(keyA).toBe('1.2.3.4');
      expect(keyB).toBe('5.6.7.8');
      expect(keyA).not.toBe(keyB);
    });
  });
});
