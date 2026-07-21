const requireNotSuspended = require('../../../src/middleware/require-not-suspended');

function run(req) {
  return new Promise((resolve, reject) => {
    requireNotSuspended(req, {}, (err) => (err ? reject(err) : resolve()));
  });
}

describe('requireNotSuspended middleware', () => {
  test('rejects with 403 ACCOUNT_SUSPENDED when the tenant is SUSPENDED', async () => {
    const req = { tenant: { id: '00000000-0000-0000-0000-000000000001', status: 'SUSPENDED' } };

    await expect(run(req)).rejects.toMatchObject({ statusCode: 403, code: 'ACCOUNT_SUSPENDED' });
  });

  test('passes through when the tenant is ACTIVE', async () => {
    const req = { tenant: { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' } };

    await expect(run(req)).resolves.toBeUndefined();
  });

  test('passes through when the tenant is PENDING_VERIFICATION', async () => {
    const req = { tenant: { id: '00000000-0000-0000-0000-000000000001', status: 'PENDING_VERIFICATION' } };

    await expect(run(req)).resolves.toBeUndefined();
  });

  test('passes through when req.tenant is not set', async () => {
    const req = {};

    await expect(run(req)).resolves.toBeUndefined();
  });
});
