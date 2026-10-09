/**
 * The real Express app, real Postgres, two tenants. Drives the tenant-facing,
 * admin and worker paths that touch RLS-protected tables and checks that
 * nothing 5xx's, nothing crosses tenants, and no query runs without a context.
 *
 *   DB_NAME=comprobify_test npm run test:integration
 */

// Before anything loads config: no external services from a test run.
for (const key of ['REDIS_URL', 'SENTRY_DSN', 'BETTERSTACK_SOURCE_TOKEN', 'PAYPHONE_TOKEN', 'PAYPHONE_STORE_ID']) process.env[key] = '';
process.env.EMAIL_PROVIDER = 'none';
process.env.SRI_MOCK_MODE = 'true';
require('dotenv').config({ quiet: true });
process.env.APP_ENV = process.env.APP_ENV || 'staging';
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'a'.repeat(64);
process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'b'.repeat(64);

// The broker is only a dispatch signal; effects are run inline below instead.
jest.mock('../../src/services/queue.service', () => ({
  ...jest.requireActual('../../src/services/queue.service'),
  connect: jest.fn().mockResolvedValue(undefined),
  publishConfirmed: jest.fn().mockResolvedValue(undefined),
}));

const crypto = require('crypto');
const http = require('http');
const config = require('../../src/config');

if (!/_test$/.test(config.db.database)) {
  throw new Error(`Refusing to run integration tests against "${config.db.database}" (DB_NAME must end in _test)`);
}

const db = require('../../src/config/database');
const rlsContext = require('../../src/config/rls-context');
const logger = require('../../src/services/logger.service');
const apiKeyModel = require('../../src/models/api-key.model');
const pendingEffectService = require('../../src/services/pending-effect.service');
const { ALL_SCOPES } = require('../../src/constants/api-key-scopes');
const Server = require('../../src/server');

const digits = (n) => Array.from({ length: n }, () => crypto.randomInt(10)).join('');
const system = (fn) => rlsContext.runAsSystem(fn);

let server;
let baseUrl;
let warn;
let createdPriceId;
const tenants = {};

const ADMIN = { Authorization: `Bearer ${process.env.ADMIN_SECRET}` };
const INTERNAL = { 'X-Internal-Service-Secret': process.env.INTERNAL_SERVICE_SECRET };

async function call(method, path, { as, headers = {}, json, form } = {}) {
  const init = { method, headers: { ...headers } };
  if (as) init.headers.Authorization = `Bearer ${tenants[as].token}`;
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  }
  if (form) init.body = form;
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body };
}

// First value stored under `key`, anywhere in a response body. Keeps the tests
// about behavior rather than each endpoint's envelope shape.
function pick(body, key) {
  if (body === null || typeof body !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(body, key)) return body[key];
  for (const value of Object.values(body)) {
    const found = pick(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

// Fails with the response body in the message, so a 500 says why.
function expectStatus(res, expected) {
  if (res.status !== expected) {
    throw new Error(`expected HTTP ${expected}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 600)}`);
  }
  return res.body;
}

async function seedTenant(label) {
  const token = `test-${label}-${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(token).digest('hex');
  await system(async () => {
    const { rows: [tenant] } = await db.query(
      `INSERT INTO tenants (email, status, subscription_tier, sandbox) VALUES ($1, 'ACTIVE', 'GROWTH', true) RETURNING id`,
      [`http-${label}-${digits(8)}@example.test`]);
    const { rows: [issuer] } = await db.query(
      `INSERT INTO issuers (tenant_id, ruc, business_name, main_address, branch_address, branch_code, issue_point_code)
       VALUES ($1, $2, $3, 'Main St', 'Main St', '001', '001') RETURNING id`,
      [tenant.id, digits(13), `HTTP Test ${label}`]);
    await db.query(
      `INSERT INTO tenant_quotas (tenant_id, period_start, period_end, document_quota, is_current)
       VALUES ($1, NOW(), NOW() + interval '1 month', 100, true)`, [tenant.id]);
    await apiKeyModel.create({ tenantId: tenant.id, keyHash, label: 'test', environment: 'sandbox', scopes: ALL_SCOPES, isReserved: true });
    tenants[label] = { id: tenant.id, issuerId: issuer.id, token };
  });
}

// Stand-in for the worker: run every effect that is waiting.
async function runPendingEffects() {
  for (let round = 0; round < 5; round += 1) {
    const { rows } = await system(() => db.query(
      `SELECT id FROM pending_effects WHERE tenant_id = ANY($1) AND status IN ('PENDING', 'DISPATCHED') AND attempt_count = 0 ORDER BY created_at`,
      [Object.values(tenants).map((t) => t.id)]));
    if (rows.length === 0) return;
    for (const { id } of rows) await pendingEffectService.process(id).catch(() => {});
  }
}

beforeAll(async () => {
  warn = jest.spyOn(logger, 'warn');
  server = http.createServer(new Server().app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await seedTenant('A');
  await seedTenant('B');
});

afterAll(async () => {
  const ids = Object.values(tenants).map((t) => t.id);
  await system(async () => {
    const bySubscription = 'SELECT p.id FROM payments p JOIN subscriptions s ON s.id = p.subscription_id WHERE s.tenant_id = ANY($1)';
    await db.query(`DELETE FROM payphone_transactions WHERE payment_id IN (${bySubscription})`, [ids]);
    await db.query(`DELETE FROM payment_proofs WHERE payment_id IN (${bySubscription})`, [ids]);
    await db.query('DELETE FROM payments WHERE subscription_id IN (SELECT id FROM subscriptions WHERE tenant_id = ANY($1))', [ids]);
    for (const table of ['pending_effects', 'webhook_deliveries', 'webhook_endpoints', 'notifications', 'notification_preferences',
      'tenant_events', 'tenant_agreements', 'tenant_quotas', 'subscriptions']) {
      await db.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1)`, [ids]);
    }
    await db.query('DELETE FROM api_key_daily_usage WHERE api_key_id IN (SELECT id FROM api_keys WHERE tenant_id = ANY($1))', [ids]);
    await db.query('DELETE FROM api_keys WHERE tenant_id = ANY($1)', [ids]);
    await db.query('DELETE FROM issuer_document_types WHERE issuer_id IN (SELECT id FROM issuers WHERE tenant_id = ANY($1))', [ids]);
    await db.query('DELETE FROM issuers WHERE tenant_id = ANY($1)', [ids]);
    await db.query('DELETE FROM tenants WHERE id = ANY($1)', [ids]);
    // tier_prices is global and append-only in the app; this row exists only for the test.
    if (createdPriceId) await db.query('DELETE FROM tier_prices WHERE id = $1', [createdPriceId]);
  }).catch((err) => console.error('HTTP fixture cleanup failed:', err.message));
  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
});

describe.each(['A', 'B'])('tenant %s: own account, messaging and billing', (label) => {
  const me = () => tenants[label];

  test('identity and account reads', async () => {
    expect(pick(expectStatus(await call('GET', '/v1/tenants/me', { as: label }), 200), 'id')).toBe(me().id);
    expectStatus(await call('GET', '/v1/tenants/events', { as: label }), 200);
    expectStatus(await call('GET', '/v1/tenants/agreements', { as: label, headers: INTERNAL }), 200);
    expectStatus(await call('GET', '/v1/tenants/agreements/history', { as: label, headers: INTERNAL }), 200);
  });

  test('notifications and preferences', async () => {
    expectStatus(await call('GET', '/v1/notifications', { as: label }), 200);
    expectStatus(await call('GET', '/v1/notifications/preferences', { as: label }), 200);
    expectStatus(await call('PATCH', '/v1/notifications/preferences', {
      as: label, json: [{ type: 'DOCUMENT_AUTHORIZED', channel: 'IN_APP', enabled: true }],
    }), 200);
  });

  test('webhook endpoints: create, list, update', async () => {
    const created = expectStatus(await call('POST', '/v1/webhooks', {
      as: label, json: { url: `https://hooks-${label.toLowerCase()}.example.test/receive` },
    }), 201);
    me().webhookId = pick(created, 'id');
    expect(me().webhookId).toBeDefined();
    const listed = expectStatus(await call('GET', '/v1/webhooks', { as: label }), 200);
    expect(JSON.stringify(listed)).toContain(me().webhookId);
    expectStatus(await call('PATCH', `/v1/webhooks/${me().webhookId}`, { as: label, json: { active: true } }), 200);
  });

  test('subscription, payment and proof upload', async () => {
    const created = expectStatus(await call('POST', '/v1/subscriptions', {
      as: label, headers: INTERNAL, json: { tier: 'BUSINESS', billingInterval: 'MONTHLY' },
    }), 201);
    me().paymentId = pick(created, 'payment').id;
    me().subscriptionId = pick(created, 'subscription').id;

    const history = expectStatus(await call('GET', '/v1/subscriptions/me', { as: label }), 200);
    expect(JSON.stringify(history)).toContain(me().paymentId);

    const form = new FormData();
    form.append('referenceNumber', `REF-${digits(8)}`);
    form.append('proof', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'proof.png');
    expectStatus(await call('PATCH', `/v1/payments/${me().paymentId}/proof`, { as: label, headers: INTERNAL, form }), 200);

    const proofs = expectStatus(await call('GET', `/v1/payments/${me().paymentId}/proofs`, { as: label }), 200);
    const list = Array.isArray(proofs) ? proofs : pick(proofs, 'proofs');
    expect(list).toHaveLength(1);
    me().proofId = list[0].id;
    expectStatus(await call('GET', `/v1/payments/${me().paymentId}/proofs/${me().proofId}`, { as: label }), 200);
  });
});

describe('tenant B cannot reach tenant A', () => {
  test('payments and proofs', async () => {
    const a = tenants.A;
    expect((await call('GET', `/v1/payments/${a.paymentId}/proofs`, { as: 'B' })).status).toBe(404);
    expect((await call('GET', `/v1/payments/${a.paymentId}/proofs/${a.proofId}`, { as: 'B' })).status).toBe(404);
    expect((await call('DELETE', `/v1/payments/${a.paymentId}`, { as: 'B', headers: INTERNAL })).status).toBe(404);
  });

  test('webhook endpoints', async () => {
    expect((await call('PATCH', `/v1/webhooks/${tenants.A.webhookId}`, { as: 'B', json: { active: false } })).status).toBe(404);
    expect((await call('DELETE', `/v1/webhooks/${tenants.A.webhookId}`, { as: 'B' })).status).toBe(404);
    const stillThere = expectStatus(await call('GET', '/v1/webhooks', { as: 'A' }), 200);
    expect(JSON.stringify(stillThere)).toContain(tenants.A.webhookId);
  });

  test('lists never mix tenants', async () => {
    const history = JSON.stringify(expectStatus(await call('GET', '/v1/subscriptions/me', { as: 'B' }), 200));
    expect(history).toContain(tenants.B.paymentId);
    expect(history).not.toContain(tenants.A.paymentId);
    const hooks = JSON.stringify(expectStatus(await call('GET', '/v1/webhooks', { as: 'B' }), 200));
    expect(hooks).not.toContain(tenants.A.webhookId);
  });

  test('another tenant\'s issuer is refused', async () => {
    const res = await call('GET', '/v1/documents', { as: 'B', headers: { 'X-Issuer-Id': tenants.A.issuerId } });
    expect(res.status).toBe(403);
  });
});

describe('admin and worker', () => {
  test('operator sees both tenants and verifies A\'s payment', async () => {
    const reported = JSON.stringify(expectStatus(await call('GET', '/v1/admin/payments?status=REPORTED', { headers: ADMIN }), 200));
    expect(reported).toContain(tenants.A.paymentId);
    expect(reported).toContain(tenants.B.paymentId);

    expectStatus(await call('GET', `/v1/admin/payments/${tenants.A.paymentId}/proofs`, { headers: ADMIN }), 200);
    expectStatus(await call('PATCH', `/v1/admin/payments/${tenants.A.paymentId}/review`, { headers: ADMIN, json: { decision: 'VERIFIED' } }), 200);

    const pending = JSON.stringify(expectStatus(await call('GET', '/v1/admin/invoicing/pending', { headers: ADMIN }), 200));
    expect(pending).toContain(tenants.A.paymentId);
    expectStatus(await call('GET', `/v1/admin/tenants/${tenants.A.id}/events`, { headers: ADMIN }), 200);
    expectStatus(await call('GET', '/v1/admin/tenants', { headers: ADMIN }), 200);
  });

  test('the verified tenant is upgraded; the other is untouched', async () => {
    expect(pick(expectStatus(await call('GET', '/v1/tenants/me', { as: 'A' }), 200), 'subscriptionTier')).toBe('BUSINESS');
    expect(pick(expectStatus(await call('GET', '/v1/tenants/me', { as: 'B' }), 200), 'subscriptionTier')).toBe('GROWTH');
  });

  test('queued effects run as their own tenant without an RLS error', async () => {
    await runPendingEffects();
    const { rows } = await system(() => db.query(
      `SELECT effect_type, status, last_error FROM pending_effects WHERE tenant_id = ANY($1)`, [Object.values(tenants).map((t) => t.id)]));
    expect(rows.length).toBeGreaterThan(0);
    const rlsFailures = rows.filter((r) => /RLS|row-level security/i.test(r.last_error || ''));
    expect(rlsFailures).toEqual([]);
  });

  test('the payment notification reaches A only, and A can mark it read', async () => {
    const mine = expectStatus(await call('GET', '/v1/notifications', { as: 'A' }), 200);
    const list = Array.isArray(mine) ? mine : pick(mine, 'notifications');
    const verified = list.find((n) => n.type === 'PAYMENT_VERIFIED');
    expect(verified).toBeDefined();

    const theirs = JSON.stringify(expectStatus(await call('GET', '/v1/notifications', { as: 'B' }), 200));
    expect(theirs).not.toContain(verified.id);
    expect((await call('POST', `/v1/notifications/${verified.id}/read`, { as: 'B' })).status).toBe(404);
    expectStatus(await call('POST', `/v1/notifications/${verified.id}/read`, { as: 'A' }), 200);
  });

  test('A\'s webhook delivery was attempted and recorded for A only', async () => {
    const { rows } = await system(() => db.query(
      'SELECT tenant_id, count(*)::int AS n FROM webhook_deliveries WHERE tenant_id = ANY($1) GROUP BY 1', [Object.values(tenants).map((t) => t.id)]));
    expect(rows).toEqual([{ tenant_id: tenants.A.id, n: expect.any(Number) }]);
  });

  test.each(['notifications', 'subscriptions', 'quota', 'queue-reconciliation', 'payphone-reconciliation'])(
    'cron job %s completes', async (job) => {
      expectStatus(await call('POST', `/v1/admin/jobs/${job}`, { headers: ADMIN }), 200);
    });

  test('an active subscriber can request a tier change and extra seats', async () => {
    const change = expectStatus(await call('POST', '/v1/subscriptions/change-tier', {
      as: 'A', headers: INTERNAL, json: { tier: 'ENTERPRISE' },
    }), 201);
    const changePaymentId = pick(change, 'payment')?.id;
    // One change at a time: seats are refused while the tier change is open.
    expect((await call('POST', '/v1/subscriptions/seats', { as: 'A', headers: INTERNAL, json: { extraSeats: 2 } })).status).toBe(409);
    if (changePaymentId) {
      expect((await call('DELETE', `/v1/payments/${changePaymentId}`, { as: 'B', headers: INTERNAL })).status).toBe(404);
      expectStatus(await call('DELETE', `/v1/payments/${changePaymentId}`, { as: 'A', headers: INTERNAL }), 200);
    }
    const seats = await call('POST', '/v1/subscriptions/seats', { as: 'A', headers: INTERNAL, json: { extraSeats: 2 } });
    expect([200, 201]).toContain(seats.status);
  });

  test('operator rejects B\'s payment and B resubmits proof', async () => {
    expectStatus(await call('PATCH', `/v1/admin/payments/${tenants.B.paymentId}/review`, {
      headers: ADMIN, json: { decision: 'REJECTED', rejectionReasonCode: 'AMOUNT_MISMATCH' },
    }), 200);
    await runPendingEffects();
    const mine = expectStatus(await call('GET', '/v1/notifications', { as: 'B' }), 200);
    const list = Array.isArray(mine) ? mine : pick(mine, 'notifications');
    expect(list.some((n) => n.type === 'PAYMENT_REJECTED')).toBe(true);

    const form = new FormData();
    form.append('referenceNumber', `REF-${digits(8)}`);
    form.append('proof', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'again.png');
    expectStatus(await call('PATCH', `/v1/payments/${tenants.B.paymentId}/proof`, { as: 'B', headers: INTERNAL, form }), 200);
  });

  test('publishing a price change notifies every active tenant, each with its own row', async () => {
    const draft = expectStatus(await call('POST', '/v1/admin/prices', {
      headers: ADMIN, json: { tier: 'LITE', billingInterval: 'YEARLY', priceUsd: 123.45 },
    }), 201);
    createdPriceId = pick(draft, 'id');
    expectStatus(await call('POST', `/v1/admin/prices/${createdPriceId}/publish`, { headers: ADMIN, json: {} }), 200);
    await runPendingEffects();
    const { rows } = await system(() => db.query(
      `SELECT tenant_id FROM notifications WHERE type = 'PRICE_CHANGE_ANNOUNCED' AND metadata->>'tierPriceId' = $1 AND tenant_id = ANY($2) ORDER BY 1`,
      [createdPriceId, [tenants.A.id, tenants.B.id]]));
    expect(rows.map((r) => r.tenant_id).sort()).toEqual([tenants.A.id, tenants.B.id].sort());
  });

  test('account settings writes', async () => {
    expectStatus(await call('PATCH', '/v1/tenants/language', { as: 'A', json: { language: 'en' } }), 200);
    const events = JSON.stringify(expectStatus(await call('GET', '/v1/tenants/events', { as: 'B' }), 200));
    expect(events).not.toContain(tenants.A.id);
  });

  test('refund rolls A back to the tier it had before the payment', async () => {
    expectStatus(await call('PATCH', `/v1/admin/payments/${tenants.A.paymentId}/refund`, { headers: ADMIN, json: {} }), 200);
    expect(pick(expectStatus(await call('GET', '/v1/tenants/me', { as: 'A' }), 200), 'subscriptionTier')).toBe('GROWTH');
  });

  test('B cannot self-cancel a payment it already reported, and can remove its own webhook', async () => {
    expect((await call('DELETE', `/v1/payments/${tenants.B.paymentId}`, { as: 'B', headers: INTERNAL })).status).toBe(409);
    expectStatus(await call('DELETE', `/v1/webhooks/${tenants.B.webhookId}`, { as: 'B' }), 200);
  });
});

describe('unauthenticated and account-lifecycle routes', () => {
  test('public and pre-tenant routes still work', async () => {
    expectStatus(await call('GET', '/health'), 200);
    expectStatus(await call('GET', '/v1/tiers'), 200);
    expectStatus(await call('GET', '/v1/agreements', { headers: INTERNAL }), 200);
    expect((await call('GET', '/v1/verify-email/check?token=does-not-exist')).status).toBe(400);
    expectStatus(await call('POST', '/v1/resend-verification', { headers: INTERNAL, json: { email: 'nobody@example.test' } }), 200);
    expect((await call('GET', '/v1/tenants/me', { headers: { Authorization: 'Bearer not-a-key' } })).status).toBe(401);
  });
});

test('no query ran without an RLS context', () => {
  const missing = warn.mock.calls.filter(([message]) => message === 'rls_context_missing').map(([, meta]) => meta);
  expect(missing).toEqual([]);
});
