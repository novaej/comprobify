jest.mock('../../../src/models/api-key.model');

const apiKeyModel = require('../../../src/models/api-key.model');
const authenticate = require('../../../src/middleware/authenticate');

const mockIssuer = { id: 1, ruc: '1712345678001', environment: '1', sandbox: true, key_environment: 'sandbox' };

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

  test('sets req.issuer and req.keyHash and calls next when token is valid', async () => {
    apiKeyModel.findByKeyHash.mockResolvedValue(mockIssuer);
    const req = makeReq('Bearer mytoken');
    await runMiddleware(req);
    expect(req.issuer).toEqual(mockIssuer);
    expect(req.keyHash).toBeDefined();
    expect(typeof req.keyHash).toBe('string');
  });

  test('passes 401 error when Authorization header is missing', async () => {
    const req = makeReq(undefined);
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('passes 401 error when Authorization header does not start with Bearer', async () => {
    const req = makeReq('Basic abc123');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('passes 401 error when token is empty', async () => {
    const req = makeReq('Bearer ');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('passes 401 error when key hash is not found in DB', async () => {
    apiKeyModel.findByKeyHash.mockResolvedValue(null);
    const req = makeReq('Bearer unknowntoken');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('hashes the token with SHA-256 before querying', async () => {
    const crypto = require('crypto');
    apiKeyModel.findByKeyHash.mockResolvedValue(mockIssuer);
    const req = makeReq('Bearer mytoken');
    await runMiddleware(req);
    const expectedHash = crypto.createHash('sha256').update('mytoken').digest('hex');
    expect(apiKeyModel.findByKeyHash).toHaveBeenCalledWith(expectedHash);
  });

  test('passes 401 error when key environment does not match issuer environment', async () => {
    // sandbox key used against a production issuer
    apiKeyModel.findByKeyHash.mockResolvedValue({ ...mockIssuer, sandbox: false, key_environment: 'sandbox' });
    const req = makeReq('Bearer mytoken');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });
});
