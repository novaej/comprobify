jest.mock('../../../src/models/issuer.model');

const issuerModel = require('../../../src/models/issuer.model');
const resolveIssuer = require('../../../src/middleware/resolve-issuer');

const sandboxIssuer = {
  id: 42,
  tenant_id: 10,
  ruc: '1712345678001',
  branch_code: '001',
  issue_point_code: '001',
  sandbox: true,
  active: true,
};

function makeReq(headers, tenantId = 10, environment = 'sandbox') {
  return {
    headers,
    tenant: { id: tenantId, status: 'ACTIVE' },
    apiKey: { id: 1, label: 'key', environment },
  };
}

function run(req) {
  return new Promise((resolve, reject) => {
    resolveIssuer(req, {}, (err) => (err ? reject(err) : resolve()));
  });
}

describe('resolveIssuer middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sets req.issuer when header is valid and tenant/env match', async () => {
    issuerModel.findById.mockResolvedValue(sandboxIssuer);
    const req = makeReq({ 'x-issuer-id': '42' });
    await run(req);
    expect(req.issuer).toEqual(sandboxIssuer);
    expect(issuerModel.findById).toHaveBeenCalledWith(42);
  });

  test('400 when X-Issuer-Id header is missing', async () => {
    const req = makeReq({});
    await expect(run(req)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('400 when X-Issuer-Id is not a positive integer', async () => {
    const req = makeReq({ 'x-issuer-id': 'abc' });
    await expect(run(req)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('400 when X-Issuer-Id is zero or negative', async () => {
    const req = makeReq({ 'x-issuer-id': '0' });
    await expect(run(req)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('404 when issuer does not exist', async () => {
    issuerModel.findById.mockResolvedValue(null);
    const req = makeReq({ 'x-issuer-id': '99' });
    await expect(run(req)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('403 when issuer belongs to a different tenant', async () => {
    issuerModel.findById.mockResolvedValue({ ...sandboxIssuer, tenant_id: 999 });
    const req = makeReq({ 'x-issuer-id': '42' });
    await expect(run(req)).rejects.toMatchObject({ statusCode: 403 });
  });

  test('401 when API key environment does not match issuer environment', async () => {
    issuerModel.findById.mockResolvedValue({ ...sandboxIssuer, sandbox: false });
    const req = makeReq({ 'x-issuer-id': '42' }, 10, 'sandbox');
    await expect(run(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('production key with production issuer passes', async () => {
    issuerModel.findById.mockResolvedValue({ ...sandboxIssuer, sandbox: false });
    const req = makeReq({ 'x-issuer-id': '42' }, 10, 'production');
    await run(req);
    expect(req.issuer.sandbox).toBe(false);
  });
});
