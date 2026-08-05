jest.mock('../../../src/services/logger.service', () => ({ info: jest.fn(), error: jest.fn() }));

const { buildLogMeta, buildLogMessage, requestLogger } = require('../../../src/middleware/request-logger');

function makeReq(overrides = {}) {
  return {
    method: 'GET',
    path: '/v1/documents',
    originalUrl: '/v1/documents?foo=bar',
    ip: '203.0.113.5',
    requestId: 'req-1',
    ...overrides,
  };
}

function makeRes(overrides = {}) {
  return { statusCode: 200, responseTime: 42, ...overrides };
}

describe('request-logger middleware', () => {
  test('exports a middleware function', () => {
    expect(typeof requestLogger).toBe('function');
  });

  describe('buildLogMeta', () => {
    test('includes the core request/response fields', () => {
      const meta = buildLogMeta(makeReq(), makeRes());

      expect(meta).toMatchObject({
        method: 'GET',
        path: '/v1/documents',
        statusCode: 200,
        durationMs: 42,
        ip: '203.0.113.5',
        requestId: 'req-1',
      });
      expect(meta.timestamp).toEqual(expect.any(String));
    });

    test('never includes the query string, even when the underlying request has one', () => {
      const req = makeReq({ path: '/v1/verify-email/check', originalUrl: '/v1/verify-email/check?token=super-secret' });

      const meta = buildLogMeta(req, makeRes());

      expect(meta.path).toBe('/v1/verify-email/check');
      expect(JSON.stringify(meta)).not.toContain('super-secret');
      expect(JSON.stringify(meta)).not.toContain('token');
    });

    test('identity fields are null when authenticate never ran', () => {
      const meta = buildLogMeta(makeReq(), makeRes());

      expect(meta.keyHash).toBeNull();
      expect(meta.apiKeyId).toBeNull();
      expect(meta.tenantId).toBeNull();
      expect(meta.issuerId).toBeNull();
    });

    test('identity fields are populated once authenticate/resolveIssuer have run', () => {
      const req = makeReq({
        keyHash: 'hash-1',
        apiKey: { id: 'key-1', label: 'frontend-prod', environment: 'sandbox' },
        tenant: { id: 'tenant-1' },
        issuer: { id: 'issuer-1' },
      });

      const meta = buildLogMeta(req, makeRes());

      expect(meta).toMatchObject({
        keyHash: 'hash-1',
        apiKeyId: 'key-1',
        tenantId: 'tenant-1',
        issuerId: 'issuer-1',
      });
    });
  });

  describe('buildLogMessage', () => {
    test('never includes the query string', () => {
      const req = makeReq({ path: '/v1/verify-email/check', originalUrl: '/v1/verify-email/check?token=super-secret' });

      const message = buildLogMessage(req, makeRes());

      expect(message).not.toContain('super-secret');
      expect(message).toBe('GET /v1/verify-email/check 200');
    });
  });
});
