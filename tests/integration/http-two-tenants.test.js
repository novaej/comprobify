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
process.env.AGREEMENTS_ENABLED = 'false'; // promotion is exercised without publishing legal documents
require('dotenv').config({ quiet: true });
process.env.APP_ENV = process.env.APP_ENV || 'staging';
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'a'.repeat(64);
process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'b'.repeat(64);
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'c'.repeat(64);
// Printed on every document as an additional-info field; the XSD rejects it empty.
process.env.OPERATOR_RUC = process.env.OPERATOR_RUC || '1790000000001';

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
const forge = require('node-forge');
const cryptoService = require('../../src/services/crypto.service');
const Server = require('../../src/server');

const digits = (n) => Array.from({ length: n }, () => crypto.randomInt(10)).join('');
const system = (fn) => rlsContext.runAsSystem(fn);

// A throwaway self-signed certificate so the test issuers can sign documents.
// Generated once: RSA key generation is the slow part.
let signing;
function signingMaterial() {
  if (signing) return signing;
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: 'commonName', value: 'RLS Test Signer' }, { name: 'organizationName', value: 'Test CA' }, { name: 'countryName', value: 'EC' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  signing = {
    encryptedPrivateKey: cryptoService.encrypt(forge.pki.privateKeyToPem(keys.privateKey)),
    certificatePem: forge.pki.certificateToPem(cert),
    expiry: cert.validity.notAfter,
  };
  return signing;
}

const invoiceBody = () => ({
  documentType: '01',
  issueDate: new Date().toLocaleDateString('en-GB', { timeZone: 'America/Guayaquil' }),
  buyer: { idType: '04', id: '1712345678001', name: 'BUYER S.A.', address: 'AV. TEST 123', email: 'buyer@example.test' },
  items: [{
    mainCode: 'SVC-001', description: 'Professional Services', quantity: '1.000000', unitPrice: '100.000000', discount: '0.00',
    taxes: [{ code: '2', rateCode: '4', rate: '15.00', taxBase: '100.00', value: '15.00' }],
  }],
  payments: [{ method: '20', total: '115.00' }],
});

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
      [tenant.id, `${digits(10)}001`, `HTTP Test ${label}`]);
    const { encryptedPrivateKey, certificatePem, expiry } = signingMaterial();
    await db.query(
      `UPDATE issuers SET encrypted_private_key = $2, certificate_pem = $3, cert_fingerprint = $4, cert_expiry = $5, required_accounting = 'NO' WHERE id = $1`,
      [issuer.id, encryptedPrivateKey, certificatePem, crypto.createHash('sha256').update(certificatePem).digest('hex'), expiry]);
    await db.query(`INSERT INTO issuer_document_types (issuer_id, document_type) VALUES ($1, '01')`, [issuer.id]);
    await db.query(
      `INSERT INTO tenant_quotas (tenant_id, period_start, period_end, document_quota, is_current)
       VALUES ($1, NOW(), NOW() + interval '1 month', 100, true)`, [tenant.id]);
    await apiKeyModel.create({ tenantId: tenant.id, keyHash, label: 'test', environment: 'sandbox', scopes: ALL_SCOPES, isReserved: true });
    tenants[label] = { id: tenant.id, issuerId: issuer.id, token };
  });
}

// Stand-in for the worker: run every effect that is waiting.
async function runPendingEffects({ only = null } = {}) {
  for (let round = 0; round < 5; round += 1) {
    const { rows } = await system(() => db.query(
      `SELECT id FROM pending_effects
       WHERE tenant_id = ANY($1) AND status IN ('PENDING', 'DISPATCHED') AND attempt_count = 0 AND ($2::text IS NULL OR effect_type = $2)
       ORDER BY created_at`,
      [Object.values(tenants).map((t) => t.id), only]));
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
    for (const schema of ['public', 'sandbox']) {
      const docs = `SELECT d.id FROM ${schema}.documents d JOIN issuers i ON i.id = d.issuer_id WHERE i.tenant_id = ANY($1)`;
      for (const table of ['sri_responses', 'document_events', 'document_line_items']) {
        await db.query(`DELETE FROM ${schema}.${table} WHERE document_id IN (${docs})`, [ids]);
      }
      await db.query(`DELETE FROM ${schema}.documents WHERE issuer_id IN (SELECT id FROM issuers WHERE tenant_id = ANY($1))`, [ids]);
      await db.query(`DELETE FROM ${schema}.sequential_numbers WHERE issuer_id IN (SELECT id FROM issuers WHERE tenant_id = ANY($1))`, [ids]);
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

describe.each(['A', 'B'])('tenant %s: issuers, API keys and documents', (label) => {
  const me = () => tenants[label];
  const withIssuer = () => ({ 'X-Issuer-Id': me().issuerId });

  test('issuer management', async () => {
    const listed = JSON.stringify(expectStatus(await call('GET', '/v1/issuers', { as: label }), 200));
    expect(listed).toContain(me().issuerId);
    expectStatus(await call('GET', `/v1/issuers/${me().issuerId}`, { as: label }), 200);
    expectStatus(await call('PATCH', `/v1/issuers/${me().issuerId}`, { as: label, json: { tradeName: `Trade ${label}` } }), 200);
    expectStatus(await call('GET', `/v1/issuers/${me().issuerId}/document-types`, { as: label }), 200);
    expectStatus(await call('GET', `/v1/issuers/${me().issuerId}/sequentials`, { as: label }), 200);
    expectStatus(await call('PATCH', `/v1/issuers/${me().issuerId}/can-issue`, { as: label, json: { canIssue: true } }), 200);
  });

  test('API key management', async () => {
    const created = expectStatus(await call('POST', '/v1/keys', { as: label, json: { label: `extra-${label}`, environment: 'sandbox' } }), 201);
    expect(pick(created, 'apiKey')).toEqual(expect.any(String));
    // The create response carries only the plaintext key; its id comes from the listing.
    const listed = expectStatus(await call('GET', '/v1/keys', { as: label }), 200);
    me().extraKeyId = pick(listed, 'keys').find((k) => k.label === `extra-${label}`).id;

    // The new key works, and only for its own tenant.
    const viaNewKey = await fetch(`${baseUrl}/v1/tenants/me`, { headers: { Authorization: `Bearer ${pick(created, 'apiKey')}` } });
    expect(pick(await viaNewKey.json(), 'id')).toBe(me().id);
    expectStatus(await call('GET', `/v1/keys/${me().extraKeyId}/usage`, { as: label }), 200);
  });

  test('document lifecycle: create, send, authorize, read, void', async () => {
    const idempotencyKey = crypto.randomUUID();
    const body = invoiceBody();
    const created = expectStatus(await call('POST', '/v1/documents', {
      as: label, headers: { ...withIssuer(), 'Idempotency-Key': idempotencyKey }, json: body,
    }), 201);
    const accessKey = pick(created, 'accessKey');
    me().accessKey = accessKey;
    expect(pick(created, 'status')).toBe('SIGNED');

    // Same key, same body: the same document comes back.
    const replay = expectStatus(await call('POST', '/v1/documents', {
      as: label, headers: { ...withIssuer(), 'Idempotency-Key': idempotencyKey }, json: body,
    }), 200);
    expect(pick(replay, 'accessKey')).toBe(accessKey);

    expectStatus(await call('POST', `/v1/documents/${accessKey}/send`, { as: label, headers: withIssuer() }), 202);
    await runPendingEffects({ only: 'SRI_SEND' });
    expect(pick(expectStatus(await call('GET', `/v1/documents/${accessKey}`, { as: label, headers: withIssuer() }), 200), 'status')).toBe('RECEIVED');
    expectStatus(await call('GET', `/v1/documents/${accessKey}/authorize`, { as: label, headers: withIssuer() }), 202);
    await runPendingEffects();

    const doc = expectStatus(await call('GET', `/v1/documents/${accessKey}`, { as: label, headers: withIssuer() }), 200);
    expect(pick(doc, 'status')).toBe('AUTHORIZED');

    for (const path of ['', '/stats']) expectStatus(await call('GET', `/v1/documents${path}`, { as: label, headers: withIssuer() }), 200);
    for (const part of ['xml', 'events', 'sri-responses', 'credit-notes']) {
      expectStatus(await call('GET', `/v1/documents/${accessKey}/${part}`, { as: label, headers: withIssuer() }), 200);
    }
    const ride = await fetch(`${baseUrl}/v1/documents/${accessKey}/ride`, { headers: { Authorization: `Bearer ${me().token}`, ...withIssuer() } });
    expect(ride.status).toBe(200);
    expect(ride.headers.get('content-type')).toMatch(/pdf/);

    const responses = expectStatus(await call('GET', `/v1/documents/${accessKey}/sri-responses`, { as: label, headers: withIssuer() }), 200);
    expect(JSON.stringify(responses)).toMatch(/RECEPTION/);
    expect(JSON.stringify(responses)).toMatch(/AUTHORIZATION/);

    // Sending is off in tests, so the buyer email is recorded as skipped, not failed.
    const { rows } = await db.queryAsIssuer(me().issuerId, 'SELECT email_status FROM documents WHERE access_key = $1', [accessKey], true);
    expect(rows[0].email_status).toBe('SKIPPED');
  });

  test('a second document can be voided, and batch email retry runs', async () => {
    const created = expectStatus(await call('POST', '/v1/documents', { as: label, headers: withIssuer(), json: invoiceBody() }), 201);
    const accessKey = pick(created, 'accessKey');
    expect(accessKey).not.toBe(me().accessKey);
    expectStatus(await call('POST', `/v1/documents/${accessKey}/send`, { as: label, headers: withIssuer() }), 202);
    await runPendingEffects();
    await runPendingEffects();
    expectStatus(await call('POST', `/v1/documents/${accessKey}/void`, {
      as: label, headers: withIssuer(), json: { confirmedSriVoid: true, reason: 'test void' },
    }), 200);
    expectStatus(await call('POST', '/v1/documents/email-retry', { as: label, headers: withIssuer() }), 200);
    expectStatus(await call('POST', '/v1/tenants/retry-failed-documents', { as: label }), 202);
  });
});

describe('tenant B cannot reach tenant A: issuers, keys and documents', () => {
  test('issuer routes answer 403, not 404, for another tenant\'s issuer', async () => {
    const id = tenants.A.issuerId;
    expect((await call('GET', `/v1/issuers/${id}`, { as: 'B' })).status).toBe(403);
    expect((await call('PATCH', `/v1/issuers/${id}`, { as: 'B', json: { tradeName: 'hijack' } })).status).toBe(403);
    expect((await call('GET', `/v1/issuers/${id}/sequentials`, { as: 'B' })).status).toBe(403);
    expect((await call('PATCH', `/v1/issuers/${id}/can-issue`, { as: 'B', json: { canIssue: false } })).status).toBe(403);
    expect(JSON.stringify(expectStatus(await call('GET', '/v1/issuers', { as: 'B' }), 200))).not.toContain(id);
  });

  test('API keys', async () => {
    expect((await call('DELETE', `/v1/keys/${tenants.A.extraKeyId}`, { as: 'B' })).status).toBe(404);
    expect((await call('GET', `/v1/keys/${tenants.A.extraKeyId}/usage`, { as: 'B' })).status).toBe(404);
    expect(JSON.stringify(expectStatus(await call('GET', '/v1/keys', { as: 'B' }), 200))).not.toContain(tenants.A.extraKeyId);
    expect(JSON.stringify(expectStatus(await call('GET', '/v1/keys', { as: 'A' }), 200))).toContain(tenants.A.extraKeyId);
  });

  test('documents', async () => {
    const key = tenants.A.accessKey;
    const ownIssuer = { 'X-Issuer-Id': tenants.B.issuerId };
    for (const part of ['', '/xml', '/events', '/ride', '/sri-responses', '/credit-notes']) {
      expect((await call('GET', `/v1/documents/${key}${part}`, { as: 'B', headers: ownIssuer })).status).toBe(404);
    }
    expect((await call('POST', `/v1/documents/${key}/void`, { as: 'B', headers: ownIssuer, json: { confirmedSriVoid: true, reason: 'x' } })).status).toBe(404);
    expect((await call('GET', `/v1/documents/${key}`, { as: 'B', headers: { 'X-Issuer-Id': tenants.A.issuerId } })).status).toBe(403);
    expect(JSON.stringify(expectStatus(await call('GET', '/v1/documents', { as: 'B', headers: ownIssuer }), 200))).not.toContain(key);
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

  test('operator links A\'s invoice and downloads a RIDE by access key', async () => {
    expectStatus(await call('PATCH', `/v1/admin/subscriptions/${tenants.A.subscriptionId}/link-invoice`, {
      headers: ADMIN, json: { accessKey: tenants.A.accessKey },
    }), 200);
    const ride = await fetch(`${baseUrl}/v1/admin/documents/${tenants.A.accessKey}/ride`, { headers: ADMIN });
    expect(ride.status).toBe(200);
    const listed = JSON.stringify(expectStatus(await call('GET', '/v1/admin/payments?status=VERIFIED', { headers: ADMIN }), 200));
    expect(listed).toContain(tenants.A.paymentId);
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

  test('webhook deliveries stay inside one tenant: notification, endpoint and delivery all agree', async () => {
    const ids = Object.values(tenants).map((t) => t.id);
    const { rows } = await system(() => db.query(
      `SELECT d.tenant_id AS delivery, n.tenant_id AS notification, w.tenant_id AS endpoint
       FROM webhook_deliveries d
       JOIN notifications n ON n.id = d.notification_id
       JOIN webhook_endpoints w ON w.id = d.webhook_id
       WHERE d.tenant_id = ANY($1)`, [ids]));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.delivery !== r.notification || r.delivery !== r.endpoint)).toEqual([]);
    expect([...new Set(rows.map((r) => r.delivery))].sort()).toEqual([...ids].sort());
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

describe('branch lifecycle', () => {
  test('A creates a branch from its own certificate, manages it, and B cannot source from it', async () => {
    const form = new FormData();
    form.append('branchCode', '002');
    form.append('issuePointCode', '001');
    form.append('sourceIssuerId', tenants.A.issuerId);
    const created = expectStatus(await call('POST', '/v1/issuers', { as: 'A', form }), 201);
    const branchId = pick(created, 'id');
    expect(branchId).toBeDefined();
    expect(branchId).not.toBe(tenants.A.issuerId);

    expectStatus(await call('POST', `/v1/issuers/${branchId}/document-types`, { as: 'A', json: { documentType: '04' } }), 200);
    expectStatus(await call('PATCH', `/v1/issuers/${branchId}/sequentials/01`, { as: 'A', json: { environment: 'sandbox', nextSequential: 50 } }), 200);
    expectStatus(await call('DELETE', `/v1/issuers/${branchId}/document-types/04`, { as: 'A' }), 200);

    // The new branch signs with the copied certificate.
    const doc = expectStatus(await call('POST', '/v1/documents', { as: 'A', headers: { 'X-Issuer-Id': branchId }, json: invoiceBody() }), 201);
    expect(pick(doc, 'sequential')).toMatch(/50$/);

    // It has a document now, so it can be paused but not removed.
    expect((await call('DELETE', `/v1/issuers/${branchId}`, { as: 'A' })).body).toMatchObject({ code: 'ISSUER_HAS_DOCUMENTS' });
    expectStatus(await call('PATCH', `/v1/issuers/${branchId}/can-issue`, { as: 'A', json: { canIssue: false } }), 200);
    expect((await call('POST', '/v1/documents', { as: 'A', headers: { 'X-Issuer-Id': branchId }, json: invoiceBody() })).status).toBe(403);

    // Another tenant can neither touch the branch nor copy A's certificate into a branch of its own.
    expect((await call('DELETE', `/v1/issuers/${branchId}`, { as: 'B' })).status).toBe(403);
    const steal = new FormData();
    steal.append('branchCode', '003');
    steal.append('issuePointCode', '001');
    steal.append('sourceIssuerId', tenants.A.issuerId);
    const stolen = await call('POST', '/v1/issuers', { as: 'B', form: steal });
    expect(stolen.status).toBeGreaterThanOrEqual(400);
    expect(stolen.status).toBeLessThan(500);
    const { rows } = await system(() => db.query(
      'SELECT count(*)::int AS n FROM issuers WHERE tenant_id = $1', [tenants.B.id]));
    expect(rows[0].n).toBe(1);
  });
});

describe('rebuild and promotion', () => {
  test('a returned document can be rebuilt by its own issuer only', async () => {
    const headers = { 'X-Issuer-Id': tenants.A.issuerId };
    const accessKey = pick(expectStatus(await call('POST', '/v1/documents', { as: 'A', headers, json: invoiceBody() }), 201), 'accessKey');
    // SRI mock mode never returns a document, so put one in RETURNED the way the worker would.
    await system(async () => {
      for (const status of ['PENDING_SEND', 'RETURNED']) {
        await db.query('UPDATE sandbox.documents SET status = $1 WHERE access_key = $2', [status, accessKey]);
      }
    });
    expect((await call('POST', `/v1/documents/${accessKey}/rebuild`, {
      as: 'B', headers: { 'X-Issuer-Id': tenants.B.issuerId }, json: invoiceBody(),
    })).status).toBe(404);
    const rebuilt = expectStatus(await call('POST', `/v1/documents/${accessKey}/rebuild`, { as: 'A', headers, json: invoiceBody() }), 200);
    expect(pick(rebuilt, 'status')).toBe('SIGNED');
    expect(pick(rebuilt, 'accessKey')).toBe(accessKey);
  });

  test('promotion moves B to production, replaces its keys, and its documents land in the public schema', async () => {
    const promoted = expectStatus(await call('POST', '/v1/tenants/promote', { as: 'B', headers: INTERNAL, json: {} }), 200);
    const productionKey = pick(promoted, 'apiKeys').find((k) => k.label === 'test').apiKey;

    // The sandbox key is revoked; the mirrored production key works.
    expect((await call('GET', '/v1/tenants/me', { as: 'B' })).status).toBe(401);
    tenants.B.token = productionKey;
    expect(pick(expectStatus(await call('GET', '/v1/tenants/me', { as: 'B' }), 200), 'sandbox')).toBe(false);

    const headers = { 'X-Issuer-Id': tenants.B.issuerId };
    const accessKey = pick(expectStatus(await call('POST', '/v1/documents', { as: 'B', headers, json: invoiceBody() }), 201), 'accessKey');
    expectStatus(await call('POST', `/v1/documents/${accessKey}/send`, { as: 'B', headers }), 202);
    await runPendingEffects();
    await runPendingEffects();
    expect(pick(expectStatus(await call('GET', `/v1/documents/${accessKey}`, { as: 'B', headers }), 200), 'status')).toBe('AUTHORIZED');

    const counts = await system(() => db.query(
      `SELECT (SELECT count(*)::int FROM public.documents  WHERE access_key = $1) AS in_public,
              (SELECT count(*)::int FROM sandbox.documents WHERE access_key = $1) AS in_sandbox`, [accessKey]));
    expect(counts.rows[0]).toEqual({ in_public: 1, in_sandbox: 0 });

    // B's earlier sandbox document is not reachable from production, and A is unaffected.
    expect((await call('GET', `/v1/documents/${tenants.B.accessKey}`, { as: 'B', headers })).status).toBe(404);
    expect(pick(expectStatus(await call('GET', '/v1/tenants/me', { as: 'A' }), 200), 'sandbox')).toBe(true);
    expectStatus(await call('GET', `/v1/issuers/${tenants.B.issuerId}/sequentials`, { as: 'B' }), 200);
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
