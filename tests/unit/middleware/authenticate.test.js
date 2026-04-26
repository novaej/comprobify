jest.mock('../../../src/models/api-key.model');

const apiKeyModel = require('../../../src/models/api-key.model');
const authenticate = require('../../../src/middleware/authenticate');

const mockRow = {
  id: 1,
  ruc: '1712345678001',
  environment: '1',
  sandbox: true,
  tenant_id: 10,
  key_environment: 'sandbox',
  tenant_status: 'ACTIVE',
  tenant_email: 'test@example.com',
  tenant_subscription_tier: 'FREE',
  tenant_invoice_count: 0,
  tenant_invoice_quota: 100,
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

  test('sets req.issuer, req.tenant, and req.keyHash when token is valid', async () => {
    apiKeyModel.findByKeyHash.mockResolvedValue(mockRow);
    const req = makeReq('Bearer mytoken');
    await runMiddleware(req);
    expect(req.issuer).toEqual(mockRow);
    expect(req.tenant).toMatchObject({ id: 10, subscriptionTier: 'FREE', status: 'ACTIVE' });
    expect(req.keyHash).toBeDefined();
    expect(typeof req.keyHash).toBe('string');
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

  test('passes 403 when tenant is suspended', async () => {
    apiKeyModel.findByKeyHash.mockResolvedValue({ ...mockRow, tenant_status: 'SUSPENDED' });
    const req = makeReq('Bearer mytoken');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 403 });
  });

  test('passes 401 when key environment does not match issuer environment', async () => {
    apiKeyModel.findByKeyHash.mockResolvedValue({ ...mockRow, sandbox: false, key_environment: 'sandbox' });
    const req = makeReq('Bearer mytoken');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('hashes the token with SHA-256 before querying', async () => {
    const crypto = require('crypto');
    apiKeyModel.findByKeyHash.mockResolvedValue(mockRow);
    const req = makeReq('Bearer mytoken');
    await runMiddleware(req);
    const expectedHash = crypto.createHash('sha256').update('mytoken').digest('hex');
    expect(apiKeyModel.findByKeyHash).toHaveBeenCalledWith(expectedHash);
  });
});
