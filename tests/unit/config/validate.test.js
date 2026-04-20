const validateConfig = require('../../../src/config/validate');

/**
 * Helper that returns a complete valid config object.
 * Individual tests override specific fields to test different scenarios.
 */
function validConfig(overrides = {}) {
  return {
    port: 8080,
    docsBaseUrl: 'https://example.com',
    encryptionKey: 'a'.repeat(64),
    adminSecret: 'secret123',
    db: {
      host: 'localhost',
      port: 5432,
      database: 'test_db',
      user: 'postgres',
      password: 'password',
      ssl: false,
    },
    sri: {
      testBaseUrl: 'https://test.sri.gob.ec',
      prodBaseUrl: 'https://prod.sri.gob.ec',
    },
    email: {
      provider: 'mailgun',
      from: 'test@example.com',
      mailgunApiKey: 'key-12345',
      mailgunDomain: 'mg.example.com',
      mailgunWebhookSigningKey: 'webhook-key-12345',
    },
    rateLimit: {
      windowMs: 60000,
      maxRequests: 60,
    },
    ...overrides,
  };
}

describe('validateConfig', () => {
  describe('always-required variables', () => {
    test('throws listing ENCRYPTION_KEY when it is missing', () => {
      const config = validConfig({ encryptionKey: '' });
      expect(() => validateConfig(config)).toThrow('Missing required environment variable(s): ENCRYPTION_KEY');
    });

    test('throws listing ADMIN_SECRET when it is missing', () => {
      const config = validConfig({ adminSecret: '' });
      expect(() => validateConfig(config)).toThrow('Missing required environment variable(s): ADMIN_SECRET');
    });

    test('throws listing both ENCRYPTION_KEY and ADMIN_SECRET in a single combined error', () => {
      const config = validConfig({ encryptionKey: '', adminSecret: '' });
      expect(() => validateConfig(config)).toThrow('Missing required environment variable(s): ENCRYPTION_KEY, ADMIN_SECRET');
    });

    test('throws with format error when ENCRYPTION_KEY is present but wrong length (too short)', () => {
      const config = validConfig({ encryptionKey: 'abc' });
      expect(() => validateConfig(config)).toThrow('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    });

    test('throws with format error when ENCRYPTION_KEY is present but wrong length (too long)', () => {
      const config = validConfig({ encryptionKey: 'a'.repeat(65) });
      expect(() => validateConfig(config)).toThrow('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    });

    test('does not throw when ENCRYPTION_KEY and ADMIN_SECRET are both valid', () => {
      const config = validConfig();
      expect(() => validateConfig(config)).not.toThrow();
    });
  });

  describe('conditional email validation', () => {
    test('throws listing all four email vars when provider=mailgun and all are missing', () => {
      const config = validConfig({
        email: {
          provider: 'mailgun',
          from: '',
          mailgunApiKey: '',
          mailgunDomain: '',
          mailgunWebhookSigningKey: '',
        },
      });
      expect(() => validateConfig(config)).toThrow(
        'Missing required environment variable(s): MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_WEBHOOK_SIGNING_KEY, EMAIL_FROM'
      );
    });

    test('throws listing only the missing email vars (partial missing)', () => {
      const config = validConfig({
        email: {
          provider: 'mailgun',
          from: 'test@example.com',
          mailgunApiKey: '',
          mailgunDomain: 'mg.example.com',
          mailgunWebhookSigningKey: 'webhook-key',
        },
      });
      expect(() => validateConfig(config)).toThrow('Missing required environment variable(s): MAILGUN_API_KEY');
    });

    test('does not throw when EMAIL_PROVIDER=none even if all email vars are empty', () => {
      const config = validConfig({
        email: {
          provider: 'none',
          from: '',
          mailgunApiKey: '',
          mailgunDomain: '',
          mailgunWebhookSigningKey: '',
        },
      });
      expect(() => validateConfig(config)).not.toThrow();
    });

    test('does not throw when email.provider is empty string (falsy), skipping email validation', () => {
      const config = validConfig({
        email: {
          provider: '',
          from: '',
          mailgunApiKey: '',
          mailgunDomain: '',
          mailgunWebhookSigningKey: '',
        },
      });
      expect(() => validateConfig(config)).not.toThrow();
    });

    test('does not throw when all required vars are correctly set', () => {
      const config = validConfig();
      expect(() => validateConfig(config)).not.toThrow();
    });
  });

  describe('edge cases', () => {
    test('throws ENCRYPTION_KEY format error before checking other vars', () => {
      const config = validConfig({
        encryptionKey: 'toolong' + 'a'.repeat(65),
        adminSecret: '',
      });
      expect(() => validateConfig(config)).toThrow('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    });

    test('does not throw when ENCRYPTION_KEY is exactly 64 characters (valid format)', () => {
      const config = validConfig({ encryptionKey: 'a'.repeat(64) });
      expect(() => validateConfig(config)).not.toThrow();
    });

    test('combines all email validation errors into a single message', () => {
      const config = validConfig({
        email: {
          provider: 'mailgun',
          from: '',
          mailgunApiKey: '',
          mailgunDomain: '',
          mailgunWebhookSigningKey: '',
        },
      });
      let caughtError;
      try {
        validateConfig(config);
      } catch (error) {
        caughtError = error;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError.message).toMatch(/MAILGUN_API_KEY/);
      expect(caughtError.message).toMatch(/MAILGUN_DOMAIN/);
      expect(caughtError.message).toMatch(/MAILGUN_WEBHOOK_SIGNING_KEY/);
      expect(caughtError.message).toMatch(/EMAIL_FROM/);
    });
  });
});
