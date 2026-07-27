const requireNotPastDue = require('../../../src/middleware/require-past-due');

function run(req) {
  return new Promise((resolve, reject) => {
    requireNotPastDue(req, {}, (err) => (err ? reject(err) : resolve()));
  });
}

describe('requireNotPastDue middleware', () => {
  test('rejects with 403 ACCOUNT_PAST_DUE when the tenant is PAST_DUE', async () => {
    const req = { tenant: { id: '00000000-0000-0000-0000-000000000001', status: 'PAST_DUE' } };

    await expect(run(req)).rejects.toMatchObject({ statusCode: 403, code: 'ACCOUNT_PAST_DUE' });
  });

  test('passes through when the tenant is ACTIVE', async () => {
    const req = { tenant: { id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' } };

    await expect(run(req)).resolves.toBeUndefined();
  });

  test('passes through when the tenant is PENDING_VERIFICATION', async () => {
    const req = { tenant: { id: '00000000-0000-0000-0000-000000000001', status: 'PENDING_VERIFICATION' } };

    await expect(run(req)).resolves.toBeUndefined();
  });

  // SUSPENDED is a distinct status with its own middleware
  // (require-not-suspended.js) — requireNotPastDue only ever checks for
  // PAST_DUE. See docs/adr/025-past-due-tenant-status.md.
  test('passes through when the tenant is SUSPENDED', async () => {
    const req = { tenant: { id: '00000000-0000-0000-0000-000000000001', status: 'SUSPENDED' } };

    await expect(run(req)).resolves.toBeUndefined();
  });

  test('passes through when req.tenant is not set', async () => {
    const req = {};

    await expect(run(req)).resolves.toBeUndefined();
  });
});
