jest.mock('../../../src/models/api-key.model');
jest.mock('../../../src/services/attempt-tracker.service');
jest.mock('../../../src/services/logger.service', () => ({ error: jest.fn() }));

const apiKeyModel = require('../../../src/models/api-key.model');
const attemptTrackerService = require('../../../src/services/attempt-tracker.service');
const logger = require('../../../src/services/logger.service');
const AttemptEventTypes = require('../../../src/constants/attempt-event-types');
const authenticate = require('../../../src/middleware/authenticate');
const { ALL_SCOPES } = require('../../../src/constants/api-key-scopes');

// touchUsage is fire-and-forget on every successful lookup — default it to
// resolve so the many pre-existing success-path tests below aren't affected.
apiKeyModel.touchUsage.mockResolvedValue(undefined);

const mockRow = {
  key_id: '00000000-0000-0000-0000-000000000007',
  tenant_id: '00000000-0000-0000-0000-000000000010',
  label: 'frontend-prod',
  key_environment: 'sandbox',
  key_scopes: ALL_SCOPES,
  tenant_status: 'ACTIVE',
  tenant_email: 'test@example.com',
  tenant_subscription_tier: 'FREE',
  tenant_document_count: 0,
  tenant_document_quota: 100,
};

function makeReq(authHeader) {
  return { headers: authHeader !== undefined ? { authorization: authHeader } : {} };
}

function runMiddleware(req) {
  return new Promise((resolve, reject) => {
    authenticate(req, {}, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe('authenticate middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sets req.tenant, req.apiKey, and req.keyHash when token is valid', async () => {
    apiKeyModel.findByKeyHash.mockResolvedValue(mockRow);
    const req = makeReq('Bearer mytoken');
    await runMiddleware(req);
    expect(req.tenant).toMatchObject({ id: '00000000-0000-0000-0000-000000000010', subscriptionTier: 'FREE', status: 'ACTIVE' });
    expect(req.apiKey).toEqual({
      id: '00000000-0000-0000-0000-000000000007',
      label: 'frontend-prod',
      environment: 'sandbox',
      scopes: ALL_SCOPES,
    });
    expect(req.keyHash).toBeDefined();
    expect(typeof req.keyHash).toBe('string');
    expect(req.issuer).toBeUndefined();
  });

  test('passes 401 when Authorization header is missing', async () => {
    const req = makeReq(undefined);
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('passes 401 when Authorization header does not start with Bearer', async () => {
    const req = makeReq('Basic abc123');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('passes 401 when token is empty', async () => {
    const req = makeReq('Bearer ');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('passes 401 when key hash is not found in DB', async () => {
    apiKeyModel.findByKeyHash.mockResolvedValue(null);
    const req = makeReq('Bearer unknowntoken');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('records an API_KEY_AUTH_FAILURE attempt when the key hash is not found', async () => {
    const crypto = require('crypto');
    apiKeyModel.findByKeyHash.mockResolvedValue(null);
    const req = makeReq('Bearer unknowntoken');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
    const expectedHash = crypto.createHash('sha256').update('unknowntoken').digest('hex');
    expect(attemptTrackerService.recordEvent).toHaveBeenCalledWith(AttemptEventTypes.API_KEY_AUTH_FAILURE, expectedHash);
  });

  test('does not record an attempt on a successful lookup', async () => {
    apiKeyModel.findByKeyHash.mockResolvedValue(mockRow);
    const req = makeReq('Bearer mytoken');
    await runMiddleware(req);
    expect(attemptTrackerService.recordEvent).not.toHaveBeenCalled();
  });

  test('does not reject a SUSPENDED tenant — that check lives in require-not-suspended.js', async () => {
    apiKeyModel.findByKeyHash.mockResolvedValue({ ...mockRow, tenant_status: 'SUSPENDED' });
    const req = makeReq('Bearer mytoken');
    await runMiddleware(req);
    expect(req.tenant.status).toBe('SUSPENDED');
  });

  test('hashes the token with SHA-256 before querying', async () => {
    const crypto = require('crypto');
    apiKeyModel.findByKeyHash.mockResolvedValue(mockRow);
    const req = makeReq('Bearer mytoken');
    await runMiddleware(req);
    const expectedHash = crypto.createHash('sha256').update('mytoken').digest('hex');
    expect(apiKeyModel.findByKeyHash).toHaveBeenCalledWith(expectedHash);
  });

  test('fires apiKeyModel.touchUsage with the key id on a successful lookup', async () => {
    apiKeyModel.findByKeyHash.mockResolvedValue(mockRow);
    const req = makeReq('Bearer mytoken');
    await runMiddleware(req);
    expect(apiKeyModel.touchUsage).toHaveBeenCalledWith(mockRow.key_id);
  });

  test('does not fire touchUsage when the key hash is not found', async () => {
    apiKeyModel.findByKeyHash.mockResolvedValue(null);
    const req = makeReq('Bearer unknowntoken');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
    expect(apiKeyModel.touchUsage).not.toHaveBeenCalled();
  });

  test('a rejected touchUsage does not fail or delay the request, and logs via logger.error', async () => {
    apiKeyModel.findByKeyHash.mockResolvedValue(mockRow);
    apiKeyModel.touchUsage.mockRejectedValueOnce(new Error('connection timeout'));
    const req = makeReq('Bearer mytoken');
    await runMiddleware(req);
    expect(req.tenant).toBeDefined();
    // Let the unawaited .catch() microtask run before asserting on it.
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.error).toHaveBeenCalledWith(
      'api_key_usage_update_failed',
      expect.objectContaining({ error: 'connection timeout', keyId: mockRow.key_id })
    );
  });
});
