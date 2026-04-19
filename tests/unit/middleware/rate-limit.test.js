const { writeLimiter, readLimiter } = require('../../../src/middleware/rate-limit');

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
});
