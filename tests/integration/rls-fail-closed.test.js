/**
 * Proves Row-Level Security is enforced and fail-loud (ADR-036, ADR-037).
 *
 * Runs against a real Postgres with all migrations applied, connected as the
 * non-superuser app role. Refuses to run unless DB_NAME ends in "_test".
 *
 *   DB_NAME=comprobify_test npm run migrate
 *   DB_NAME=comprobify_test npm run test:integration
 */

require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const { Pool } = require('pg');
const config = require('../../src/config');

if (!/_test$/.test(config.db.database)) {
  throw new Error(`Refusing to run RLS integration tests against "${config.db.database}" (DB_NAME must end in _test)`);
}

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  ssl: config.db.ssl,
  max: 2,
});

const RLS_VIOLATION = '42501';
const NO_CONTEXT = { code: RLS_VIOLATION, message: expect.stringMatching(/^RLS: no (tenant|issuer) or system context/) };
const POLICY_REJECTED = { code: RLS_VIOLATION, message: expect.stringMatching(/row-level security policy/) };
const SCHEMAS = ['public', 'sandbox'];

const digits = (n) => Array.from({ length: n }, () => crypto.randomInt(10)).join('');

// Raw SQL on purpose: fixtures must not depend on the JS helpers under test.
async function inTx(setup, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of setup) {
      await client.query('SELECT set_config($1, $2, true)', [key, value]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const asSystem = (fn) => inTx([['app.rls_system', 'on']], fn);
const asIssuer = (issuerId, fn) => inTx([['app.current_issuer_id', issuerId]], fn);
const asTenant = (tenantId, fn) => inTx([['app.current_tenant_id', tenantId]], fn);
const noContext = (fn) => inTx([], fn);
const count = async (client, table, where = 'true', params = []) =>
  Number((await client.query(`SELECT count(*) FROM ${table} WHERE ${where}`, params)).rows[0].count);

const byTenant = (table, insert) => ({
  table: `public.${table}`,
  ctx: 'tenant',
  link: 'tenant_id',
  owned: (o) => ['tenant_id = $1', [o.tenantId]],
  insert,
});

// One entry per protected table. `insert` adds a row owned by `o` (an owner
// from `fx`); `extra` asks for a second row that avoids unique collisions.
const docChild = (schema, table, insertSql) => ({
  table: `${schema}.${table}`,
  ctx: 'issuer',
  link: 'document_id',
  owned: (o) => ['document_id = $1', [o.docs[schema].id]],
  insert: (c, o) => c.query(insertSql, [o.docs[schema].id]),
});

const documentTables = SCHEMAS.flatMap((schema) => [
  {
    table: `${schema}.documents`,
    ctx: 'issuer',
    link: 'issuer_id',
    owned: (o) => ['issuer_id = $1', [o.issuerId]],
    insert: async (c, o) => {
      const { rows: [doc] } = await c.query(
        `INSERT INTO ${schema}.documents (issuer_id, document_type, access_key, sequential, branch_code, issue_point_code, issue_date, email_message_id)
         VALUES ($1, '01', $2, 1, '001', '001', CURRENT_DATE, $3) RETURNING id, access_key, email_message_id`,
        [o.issuerId, digits(49), `msg-${digits(12)}@mg.test`]);
      o.docs[schema] = o.docs[schema] || doc;
    },
  },
  docChild(schema, 'document_line_items',
    `INSERT INTO ${schema}.document_line_items (document_id, main_code, description, quantity, unit_price, subtotal, taxes, line_total)
     VALUES ($1, 'P1', 'Item', 1, 10, 10, '[]', 10)`),
  docChild(schema, 'document_events', `INSERT INTO ${schema}.document_events (document_id, event_type) VALUES ($1, 'CREATED')`),
  docChild(schema, 'sri_responses', `INSERT INTO ${schema}.sri_responses (document_id, operation_type) VALUES ($1, 'RECEPTION')`),
  {
    table: `${schema}.sequential_numbers`,
    ctx: 'issuer',
    link: 'issuer_id',
    owned: (o) => ['issuer_id = $1', [o.issuerId]],
    insert: (c, o, extra) => c.query(
      `INSERT INTO ${schema}.sequential_numbers (issuer_id, branch_code, issue_point_code, document_type, current_value)
       VALUES ($1, '001', '001', $2, 1)`, [o.issuerId, extra ? '07' : '01']),
  },
]);


const tenantTables = [
  byTenant('notifications', async (c, o) => {
    const { rows: [row] } = await c.query(
      `INSERT INTO notifications (tenant_id, type, title, message) VALUES ($1, 'DOCUMENT_AUTHORIZED', 't', 'm') RETURNING id`, [o.tenantId]);
    o.notificationId = o.notificationId || row.id;
  }),
  byTenant('notification_preferences', (c, o, extra) => c.query(
    `INSERT INTO notification_preferences (tenant_id, type, channel) VALUES ($1, $2, 'IN_APP')`,
    [o.tenantId, extra ? 'CERT_EXPIRING' : 'DOCUMENT_AUTHORIZED'])),
  byTenant('webhook_endpoints', async (c, o) => {
    const { rows: [row] } = await c.query(
      `INSERT INTO webhook_endpoints (tenant_id, url, secret) VALUES ($1, 'https://example.test/hook', 's') RETURNING id`, [o.tenantId]);
    o.webhookId = o.webhookId || row.id;
  }),
  byTenant('webhook_deliveries', (c, o) => c.query(
    `INSERT INTO webhook_deliveries (notification_id, webhook_id, tenant_id) VALUES ($1, $2, $3)`,
    [o.notificationId, o.webhookId, o.tenantId])),
  byTenant('tenant_events', (c, o) => c.query(
    `INSERT INTO tenant_events (tenant_id, event_type) VALUES ($1, 'VERIFICATION_EMAIL_SENT')`, [o.tenantId])),
  byTenant('tenant_agreements', (c, o) => c.query(
    `INSERT INTO tenant_agreements (tenant_id, document_type, template_version, content_markdown, content_hash)
     VALUES ($1, 'TERMS', $2, '# terms', 'hash')`, [o.tenantId, `v-${digits(8)}`])),
  byTenant('subscriptions', async (c, o) => {
    const { rows: [row] } = await c.query(
      `INSERT INTO subscriptions (tenant_id, tier) VALUES ($1, 'STARTER') RETURNING id`, [o.tenantId]);
    o.subscriptionId = o.subscriptionId || row.id;
  }),
  byTenant('tenant_quotas', (c, o, extra) => c.query(
    `INSERT INTO tenant_quotas (tenant_id, period_start, period_end, is_current) VALUES ($1, NOW(), NOW() + interval '1 month', $2)`,
    [o.tenantId, !extra])),
  {
    table: 'public.payments',
    ctx: 'tenant',
    link: 'subscription_id',
    owned: (o) => ['subscription_id = $1', [o.subscriptionId]],
    insert: async (c, o) => {
      const { rows: [row] } = await c.query(
        `INSERT INTO payments (subscription_id, amount) VALUES ($1, 10) RETURNING id`, [o.subscriptionId]);
      o.paymentId = o.paymentId || row.id;
    },
  },
  {
    table: 'public.payment_proofs',
    ctx: 'tenant',
    link: 'payment_id',
    owned: (o) => ['payment_id = $1', [o.paymentId]],
    insert: (c, o) => c.query(
      `INSERT INTO payment_proofs (payment_id, file, filename, mime_type) VALUES ($1, '\\x00', 'p.png', 'image/png')`, [o.paymentId]),
  },
  {
    table: 'public.payphone_transactions',
    ctx: 'tenant',
    link: 'payment_id',
    owned: (o) => ['payment_id = $1', [o.paymentId]],
    insert: (c, o) => c.query(
      `INSERT INTO payphone_transactions (payment_id, client_transaction_id, amount_cents) VALUES ($1, $2, 1000)`,
      [o.paymentId, `ct-${digits(16)}`]),
  },
];

// The identity tables. seedOwner() creates each owner's tenant and first
// issuer itself, so the base insert is a no-op for those two.
const identityTables = [
  {
    table: 'public.tenants',
    ctx: 'tenant',
    link: 'id',
    canInsertOwn: false, // a tenant row is its own owner; there is no second one to add
    owned: (o) => ['id = $1', [o.tenantId]],
    insert: (c, o, extra) => (extra
      ? c.query('INSERT INTO tenants (id, email) VALUES ($1, $2)', [o.tenantId, `dup-${digits(8)}@example.test`])
      : null),
  },
  byTenant('issuers', (c, o, extra) => (extra
    ? c.query(
      `INSERT INTO issuers (tenant_id, ruc, business_name, main_address, branch_address, branch_code, issue_point_code)
       VALUES ($1, $2, 'Extra', 'Main St', 'Main St', '002', '001')`, [o.tenantId, digits(13)])
    : null)),
  byTenant('api_keys', async (c, o) => {
    const { rows: [row] } = await c.query(
      `INSERT INTO api_keys (tenant_id, key_hash, environment) VALUES ($1, $2, 'sandbox') RETURNING id`,
      [o.tenantId, crypto.randomBytes(32).toString('hex')]);
    o.apiKeyId = o.apiKeyId || row.id;
  }),
  {
    table: 'public.api_key_daily_usage',
    ctx: 'tenant',
    link: 'api_key_id',
    owned: (o) => ['api_key_id = $1', [o.apiKeyId]],
    insert: (c, o, extra) => c.query(
      `INSERT INTO api_key_daily_usage (api_key_id, usage_date, last_used_at) VALUES ($1, CURRENT_DATE - $2::int, NOW())`,
      [o.apiKeyId, extra ? crypto.randomInt(1, 100000) : 0]),
  },
  {
    table: 'public.issuer_document_types',
    ctx: 'tenant',
    link: 'issuer_id',
    owned: (o) => ['issuer_id = $1', [o.issuerId]],
    insert: (c, o, extra) => c.query(
      `INSERT INTO issuer_document_types (issuer_id, document_type) VALUES ($1, $2)`, [o.issuerId, extra ? '04' : '01']),
  },
  byTenant('pending_effects', (c, o) => c.query(
    `INSERT INTO pending_effects (tenant_id, effect_type, payload) VALUES ($1, 'WEBHOOK_FANOUT', '{}')`, [o.tenantId])),
];

const TABLES = [...identityTables, ...documentTables, ...tenantTables];
const NAMES = TABLES.map((t) => t.table);
const spec = (name) => TABLES.find((t) => t.table === name);

const fx = { A: { docs: {} }, B: { docs: {} } };
const as = (t, o, fn) => (t.ctx === 'issuer' ? asIssuer(o.issuerId, fn) : asTenant(o.tenantId, fn));

async function seedOwner(client, label) {
  const o = fx[label];
  const { rows: [tenant] } = await client.query(
    'INSERT INTO tenants (email) VALUES ($1) RETURNING id', [`rls-${label}-${digits(8)}@example.test`]);
  const { rows: [issuer] } = await client.query(
    `INSERT INTO issuers (tenant_id, ruc, business_name, main_address, branch_address, branch_code, issue_point_code)
     VALUES ($1, $2, $3, 'Main St', 'Main St', '001', '001') RETURNING id`,
    [tenant.id, digits(13), `RLS Test ${label}`]);
  o.tenantId = tenant.id;
  o.issuerId = issuer.id;
  for (const t of TABLES) await t.insert(client, o, false);
}

beforeAll(async () => {
  await asSystem(async (client) => {
    await seedOwner(client, 'A');
    await seedOwner(client, 'B');
  });
});

afterAll(async () => {
  await asSystem(async (client) => {
    const tenants = [fx.A.tenantId, fx.B.tenantId];
    const issuers = [fx.A.issuerId, fx.B.issuerId];
    for (const table of ['payphone_transactions', 'payment_proofs']) {
      await client.query(`DELETE FROM ${table} WHERE payment_id IN (SELECT p.id FROM payments p JOIN subscriptions s ON s.id = p.subscription_id WHERE s.tenant_id = ANY($1))`, [tenants]);
    }
    await client.query('DELETE FROM payments WHERE subscription_id IN (SELECT id FROM subscriptions WHERE tenant_id = ANY($1))', [tenants]);
    for (const table of ['webhook_deliveries', 'webhook_endpoints', 'notifications', 'notification_preferences', 'tenant_events', 'tenant_agreements', 'tenant_quotas', 'subscriptions']) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1)`, [tenants]);
    }
    for (const schema of SCHEMAS) {
      for (const table of ['sri_responses', 'document_events', 'document_line_items']) {
        await client.query(
          `DELETE FROM ${schema}.${table} WHERE document_id IN (SELECT id FROM ${schema}.documents WHERE issuer_id = ANY($1))`, [issuers]);
      }
      await client.query(`DELETE FROM ${schema}.documents WHERE issuer_id = ANY($1)`, [issuers]);
      await client.query(`DELETE FROM ${schema}.sequential_numbers WHERE issuer_id = ANY($1)`, [issuers]);
    }
    await client.query('DELETE FROM pending_effects WHERE tenant_id = ANY($1)', [tenants]);
    await client.query('DELETE FROM api_key_daily_usage WHERE api_key_id IN (SELECT id FROM api_keys WHERE tenant_id = ANY($1))', [tenants]);
    await client.query('DELETE FROM api_keys WHERE tenant_id = ANY($1)', [tenants]);
    await client.query('DELETE FROM issuer_document_types WHERE issuer_id IN (SELECT id FROM issuers WHERE tenant_id = ANY($1))', [tenants]);
    await client.query('DELETE FROM issuers WHERE tenant_id = ANY($1)', [tenants]);
    await client.query('DELETE FROM tenants WHERE id = ANY($1)', [tenants]);
  }).catch((err) => console.error('RLS fixture cleanup failed:', err.message));
  await pool.end();
  // The app's own pool is opened by the model-level tests below.
  await require('../../src/config/database').pool.end().catch(() => {});
});

describe('catalog: every protected table is locked down', () => {
  test('connecting role cannot bypass RLS', async () => {
    const { rows: [role] } = await pool.query(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  test.each(NAMES)('%s has RLS enabled and forced', async (qualified) => {
    const { rows: [row] } = await pool.query(
      'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass', [qualified]);
    expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  test.each(NAMES)('%s has a fail-loud policy with an explicit WITH CHECK', async (qualified) => {
    const [schema, table] = qualified.split('.');
    const { rows } = await pool.query(
      'SELECT qual, with_check FROM pg_policies WHERE schemaname = $1 AND tablename = $2', [schema, table]);
    expect(rows).toHaveLength(1);
    const [policy] = rows;
    expect(policy.with_check).not.toBeNull();
    for (const expression of [policy.qual, policy.with_check]) {
      expect(expression).not.toMatch(/IS NULL/i);
      expect(expression).toMatch(/app_is_system\(\)/);
      expect(expression).toMatch(spec(qualified).ctx === 'issuer' ? /app_require_issuer_id\(\)/ : /app_require_tenant_id\(\)/);
    }
  });

  test('sandbox child policies reference sandbox.documents, not public', async () => {
    const { rows } = await pool.query(
      `SELECT tablename, qual FROM pg_policies
       WHERE schemaname = 'sandbox' AND tablename IN ('document_line_items', 'document_events', 'sri_responses')`);
    expect(rows).toHaveLength(3);
    for (const policy of rows) expect(policy.qual).toMatch(/sandbox\.documents/);
  });

  test('no table that carries an owner column is left without RLS', async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT c.table_schema || '.' || c.table_name AS t
       FROM information_schema.columns c
       JOIN pg_class k ON k.oid = (c.table_schema || '.' || c.table_name)::regclass
       WHERE c.table_schema IN ('public', 'sandbox')
         AND c.column_name IN ('tenant_id', 'issuer_id', 'document_id', 'subscription_id', 'payment_id', 'api_key_id')
         AND k.relkind = 'r' AND NOT k.relrowsecurity
       ORDER BY 1`);
    // Every table that names an owner is protected. Anything listed here is a new table that skipped RLS.
    expect(rows.map((r) => r.t)).toEqual([]);
  });
});

describe('no context: fails loud', () => {
  test.each(NAMES)('%s: SELECT, UPDATE, DELETE and INSERT all raise', async (qualified) => {
    const t = spec(qualified);
    const [where, params] = t.owned(fx.A);
    await expect(noContext((c) => count(c, qualified))).rejects.toMatchObject(NO_CONTEXT);
    await expect(noContext((c) => c.query(`UPDATE ${qualified} SET ${t.link} = ${t.link} WHERE ${where}`, params))).rejects.toMatchObject(NO_CONTEXT);
    await expect(noContext((c) => c.query(`DELETE FROM ${qualified} WHERE ${where}`, params))).rejects.toMatchObject(NO_CONTEXT);
    await expect(noContext((c) => t.insert(c, fx.A, true))).rejects.toMatchObject(NO_CONTEXT);
    expect(await asSystem((c) => count(c, qualified, where, params))).toBeGreaterThan(0);
  });

  test.each(NAMES)('%s: an empty-string context is no context', async (qualified) => {
    const setup = [['app.current_tenant_id', ''], ['app.current_issuer_id', ''], ['app.rls_system', '']];
    await expect(inTx(setup, (c) => count(c, qualified))).rejects.toMatchObject(NO_CONTEXT);
  });

  test.each(NAMES)('%s: the wrong kind of context is not enough', async (qualified) => {
    // A tenant context does not open document tables, and an issuer context does not open tenant tables.
    const t = spec(qualified);
    const wrong = t.ctx === 'issuer' ? asTenant(fx.A.tenantId, (c) => count(c, qualified)) : asIssuer(fx.A.issuerId, (c) => count(c, qualified));
    await expect(wrong).rejects.toMatchObject(NO_CONTEXT);
  });

  test('a query Postgres can prove returns nothing may skip the check, and still returns nothing', async () => {
    // Fail-loud is "whenever a row is examined". With no rows to examine there is nothing to raise on, or to leak.
    for (const table of ['public.notifications', 'public.documents']) {
      const outcome = await noContext((c) => count(c, table, 'false')).catch((err) => err);
      expect(outcome === 0 || outcome.code === RLS_VIOLATION).toBe(true);
    }
  });

  test('a malformed context never widens access', async () => {
    for (const key of ['app.current_tenant_id', 'app.current_issuer_id']) {
      const table = key.includes('tenant') ? 'public.notifications' : 'public.documents';
      await expect(inTx([[key, 'not-a-uuid']], (c) => count(c, table))).rejects.toThrow();
    }
  });

  test('rls_system only accepts the exact value "on"', async () => {
    for (const value of ['true', '1', 'ON ', 'off']) {
      await expect(inTx([['app.rls_system', value]], (c) => count(c, 'public.documents'))).rejects.toMatchObject(NO_CONTEXT);
      await expect(inTx([['app.rls_system', value]], (c) => count(c, 'public.payments'))).rejects.toMatchObject(NO_CONTEXT);
    }
  });
});

describe('own context: sees and changes only its own rows', () => {
  test.each(NAMES)('%s: A sees A, never B', async (qualified) => {
    const t = spec(qualified);
    const [own, other] = await as(t, fx.A, async (c) => [
      await count(c, qualified, ...t.owned(fx.A)),
      await count(c, qualified, ...t.owned(fx.B)),
    ]);
    expect(own).toBeGreaterThan(0);
    expect(other).toBe(0);
    expect(await as(t, fx.A, (c) => count(c, qualified))).toBe(own);
  });

  test.each(NAMES)('%s: A cannot update or delete B rows', async (qualified) => {
    const t = spec(qualified);
    const [where, params] = t.owned(fx.B);
    const before = await asSystem((c) => count(c, qualified, where, params));
    const touched = await as(t, fx.A, async (c) => {
      const upd = await c.query(`UPDATE ${qualified} SET ${t.link} = ${t.link} WHERE ${where}`, params);
      const del = await c.query(`DELETE FROM ${qualified} WHERE ${where}`, params);
      return upd.rowCount + del.rowCount;
    });
    expect(touched).toBe(0);
    expect(await asSystem((c) => count(c, qualified, where, params))).toBe(before);
  });

  test.each(NAMES)('%s: A cannot insert a row owned by B', async (qualified) => {
    const t = spec(qualified);
    await expect(as(t, fx.A, (c) => t.insert(c, fx.B, true))).rejects.toMatchObject(POLICY_REJECTED);
  });

  test.each(NAMES)('%s: A can insert and update its own rows', async (qualified) => {
    const t = spec(qualified);
    const [where, params] = t.owned(fx.A);
    await as(t, fx.A, async (c) => {
      if (t.canInsertOwn !== false) await t.insert(c, fx.A, true);
      const upd = await c.query(`UPDATE ${qualified} SET ${t.link} = ${t.link} WHERE ${where}`, params);
      expect(upd.rowCount).toBeGreaterThan(0);
    });
  });

  test.each([
    ['public.sequential_numbers', 'issuer_id', (o) => o.issuerId],
    ['sandbox.sequential_numbers', 'issuer_id', (o) => o.issuerId],
    ['public.issuers', 'tenant_id', (o) => o.tenantId],
    ['public.api_keys', 'tenant_id', (o) => o.tenantId],
    ['public.pending_effects', 'tenant_id', (o) => o.tenantId],
    ['public.issuer_document_types', 'issuer_id', (o) => o.issuerId],
    ['public.notifications', 'tenant_id', (o) => o.tenantId],
    ['public.subscriptions', 'tenant_id', (o) => o.tenantId],
    ['public.webhook_endpoints', 'tenant_id', (o) => o.tenantId],
    ['public.payments', 'subscription_id', (o) => o.subscriptionId],
    ['public.payment_proofs', 'payment_id', (o) => o.paymentId],
  ])('%s: A cannot move its own row to B', async (qualified, column, valueOf) => {
    // WITH CHECK rejects the new row. (documents.issuer_id is also immutable by trigger, migration 026.)
    const t = spec(qualified);
    const [where, params] = t.owned(fx.A);
    const extra = column === 'issuer_id' ? ", document_type = '06'" : (qualified === 'public.issuers' ? ", branch_code = '009'" : '');
    await expect(as(t, fx.A, (c) => c.query(
      `UPDATE ${qualified} SET ${column} = $${params.length + 1}${extra} WHERE ${where}`, [...params, valueOf(fx.B)],
    ))).rejects.toMatchObject(POLICY_REJECTED);
  });
});

describe('system context', () => {
  test.each(NAMES)('%s: sees both owners', async (qualified) => {
    const t = spec(qualified);
    const [a, b] = await asSystem(async (c) => [
      await count(c, qualified, ...t.owned(fx.A)), await count(c, qualified, ...t.owned(fx.B))]);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });

  test('context does not leak to the next transaction on the same connection', async () => {
    const client = await pool.connect();
    const sample = { 'app.rls_system': ['on', 'public.documents'], 'app.current_issuer_id': [fx.A.issuerId, 'public.documents'], 'app.current_tenant_id': [fx.A.tenantId, 'public.notifications'] };
    try {
      for (const [key, [value, table]] of Object.entries(sample)) {
        await client.query('BEGIN');
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
        expect(await count(client, table)).toBeGreaterThan(0);
        await client.query('COMMIT');
        await expect(count(client, table)).rejects.toMatchObject(NO_CONTEXT);
      }
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.rls_system', 'on', true)");
      await client.query('ROLLBACK');
      await expect(count(client, 'public.documents')).rejects.toMatchObject(NO_CONTEXT);
    } finally {
      client.release();
    }
  });
});

describe('integrity checks still work under RLS', () => {
  test('access_key uniqueness is enforced across issuers', async () => {
    await expect(asIssuer(fx.B.issuerId, (c) => c.query(
      `INSERT INTO public.documents (issuer_id, document_type, access_key, sequential, branch_code, issue_point_code, issue_date)
       VALUES ($1, '01', $2, 9, '001', '001', CURRENT_DATE)`, [fx.B.issuerId, fx.A.docs.public.access_key],
    ))).rejects.toMatchObject({ code: '23505' });
  });

  test('foreign keys are checked regardless of context', async () => {
    await expect(asSystem((c) => c.query(
      `INSERT INTO public.documents (issuer_id, document_type, access_key, sequential, branch_code, issue_point_code, issue_date)
       VALUES ($1, '01', $2, 9, '001', '001', CURRENT_DATE)`, [crypto.randomUUID(), digits(49)],
    ))).rejects.toMatchObject({ code: '23503' });
    // A's notification exists but is invisible to B; the FK still has to see it.
    await expect(asTenant(fx.B.tenantId, (c) => c.query(
      `INSERT INTO webhook_deliveries (notification_id, webhook_id, tenant_id) VALUES ($1, $2, $3)`,
      [fx.A.notificationId, fx.B.webhookId, fx.B.tenantId],
    ))).resolves.toMatchObject({ rowCount: 1 });
  });
});

// Everything below goes through the real app code that used to rely on the bypass.
describe('application code paths', () => {
  const db = require('../../src/config/database');
  const rlsContext = require('../../src/config/rls-context');
  const documentModel = require('../../src/models/document.model');
  const documentEventModel = require('../../src/models/document-event.model');
  const sriResponseModel = require('../../src/models/sri-response.model');
  const sequentialService = require('../../src/services/sequential.service');

  test('db.query() with no context is rejected on protected tables', async () => {
    await expect(db.query('SELECT count(*)::int AS n FROM public.documents')).rejects.toMatchObject(NO_CONTEXT);
    await expect(db.query('SELECT count(*)::int AS n FROM payments')).rejects.toMatchObject(NO_CONTEXT);
  });

  test('db.query() inside a tenant context sees only that tenant', async () => {
    const { rows } = await rlsContext.runAsTenant(fx.A.tenantId, () => db.query('SELECT DISTINCT tenant_id FROM notifications'));
    expect(rows).toEqual([{ tenant_id: fx.A.tenantId }]);
    const system = await rlsContext.runAsSystem(() => db.query(
      'SELECT count(DISTINCT tenant_id)::int AS n FROM notifications WHERE tenant_id = ANY($1)', [[fx.A.tenantId, fx.B.tenantId]]));
    expect(system.rows[0].n).toBe(2);
  });

  test('a tenant context alone does not open document tables through db.query()', async () => {
    await expect(rlsContext.runAsTenant(fx.A.tenantId, () => db.query('SELECT count(*) FROM public.documents'))).rejects.toMatchObject(NO_CONTEXT);
  });

  test('an issuer transaction inside a tenant context can update that tenant\'s quota', async () => {
    // What document creation does: one transaction, document tables and tenant_quotas together.
    const touched = await rlsContext.runAsTenant(fx.A.tenantId, async () => {
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        await db.setIssuerContext(client, fx.A.issuerId, false);
        const docs = await client.query('SELECT count(*)::int AS n FROM documents');
        const quota = await client.query('UPDATE tenant_quotas SET document_count = document_count WHERE tenant_id = $1', [fx.A.tenantId]);
        await client.query('COMMIT');
        return { docs: docs.rows[0].n, quota: quota.rowCount };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });
    expect(touched.docs).toBeGreaterThan(0);
    expect(touched.quota).toBeGreaterThan(0);
  });

  test('db.queryAsIssuer scopes to the issuer and routes to the right schema', async () => {
    for (const [sandbox, schema] of [[false, 'public'], [true, 'sandbox']]) {
      const { rows } = await db.queryAsIssuer(fx.A.issuerId, 'SELECT id, issuer_id FROM documents', [], sandbox);
      expect(rows.map((r) => r.id)).toContain(fx.A.docs[schema].id);
      expect(rows.every((r) => r.issuer_id === fx.A.issuerId)).toBe(true);
      // The other schema's document must not show up: search_path picked this one.
      expect(rows.map((r) => r.id)).not.toContain(fx.A.docs[schema === 'public' ? 'sandbox' : 'public'].id);
    }
  });

  test('db.queryAsSystem sees every issuer and does not leak', async () => {
    const { rows } = await db.queryAsSystem(
      'SELECT count(DISTINCT issuer_id)::int AS n FROM public.documents WHERE issuer_id = ANY($1)', [[fx.A.issuerId, fx.B.issuerId]]);
    expect(rows[0].n).toBe(2);
    await expect(db.query('SELECT count(*)::int AS n FROM public.documents')).rejects.toMatchObject(NO_CONTEXT);
  });

  test('concurrent issuer queries never see each other\'s rows', async () => {
    const run = (label) => db.queryAsIssuer(fx[label].issuerId, 'SELECT issuer_id FROM documents', [], false)
      .then(({ rows }) => rows.length > 0 && rows.every((r) => r.issuer_id === fx[label].issuerId));
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => run(i % 2 ? 'A' : 'B')));
    expect(results.every(Boolean)).toBe(true);
  });

  describe.each([[false, 'public'], [true, 'sandbox']])('sandbox=%s', (sandbox, schema) => {
    test('findByAccessKey: own issuer finds it, other issuer does not', async () => {
      const key = fx.A.docs[schema].access_key;
      expect(await documentModel.findByAccessKey(key, fx.A.issuerId, sandbox)).toMatchObject({ id: fx.A.docs[schema].id });
      expect(await documentModel.findByAccessKey(key, fx.B.issuerId, sandbox)).toBeFalsy();
    });

    test('findByAccessKey with no issuer (admin link-invoice, admin RIDE) still finds it', async () => {
      const doc = await documentModel.findByAccessKey(fx.A.docs[schema].access_key);
      expect(doc).toMatchObject({ id: fx.A.docs[schema].id, sandbox });
    });

    test('Mailgun webhook: lookup by message id, status update, event write', async () => {
      const found = await documentModel.findByEmailMessageId(fx.A.docs[schema].email_message_id);
      expect(found).toMatchObject({ id: fx.A.docs[schema].id, sandbox });

      // Signature may gain an issuerId argument; pass it positionally last.
      const updated = await documentModel.updateEmailStatus(found.id, 'DELIVERED', sandbox, found.issuer_id);
      expect(updated).toMatchObject({ email_status: 'DELIVERED' });

      const event = await documentEventModel.create(
        found.id, 'EMAIL_DELIVERED', null, null, { to: 'x@example.test' }, null, found.issuer_id, sandbox);
      expect(event).toMatchObject({ document_id: found.id });
    });

    test('sri_responses: create and read back in issuer context', async () => {
      // The worker path. Before the fix this was a context-free db.query().
      const created = await sriResponseModel.create({
        documentId: fx.A.docs[schema].id, operationType: 'AUTHORIZATION', status: 'AUTORIZADO',
        messages: [], rawResponse: '<x/>', sandbox, issuerId: fx.A.issuerId,
      });
      expect(created).toMatchObject({ document_id: fx.A.docs[schema].id });
      const rows = await sriResponseModel.findByDocumentId(fx.A.docs[schema].id, sandbox, fx.A.issuerId);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(await sriResponseModel.findByDocumentId(fx.A.docs[schema].id, sandbox, fx.B.issuerId)).toEqual([]);
    });

    test('document events: read is issuer scoped', async () => {
      expect((await documentEventModel.findByDocumentId(fx.A.docs[schema].id, fx.A.issuerId, sandbox)).length).toBeGreaterThan(0);
      expect(await documentEventModel.findByDocumentId(fx.A.docs[schema].id, fx.B.issuerId, sandbox)).toEqual([]);
    });

    test('updateStatus: other issuer cannot move the document', async () => {
      const result = await documentModel.updateStatus(fx.A.docs[schema].id, 'SIGNED', { buyer_name: 'hijack' }, fx.B.issuerId, sandbox);
      expect(result).toBeFalsy();
    });

    test('sequentials: getNext increments only the caller\'s counter', async () => {
      const before = await asSystem((c) => c.query(
        `SELECT current_value FROM ${schema}.sequential_numbers WHERE issuer_id = $1`, [fx.B.issuerId]));
      const next = await sequentialService.getNext(fx.A.issuerId, '001', '001', '01', null, sandbox);
      expect(Number(next)).toBeGreaterThan(1);
      const after = await asSystem((c) => c.query(
        `SELECT current_value FROM ${schema}.sequential_numbers WHERE issuer_id = $1`, [fx.B.issuerId]));
      expect(after.rows).toEqual(before.rows);
    });
  });

  test('existsByIssuerId sees documents in either schema', async () => {
    expect(await documentModel.existsByIssuerId(fx.A.issuerId)).toBe(true);
  });

  test('getCounters reads both schemas for one issuer', async () => {
    const counters = await sequentialService.getCounters(fx.A.issuerId, ['01']);
    expect(JSON.stringify(counters)).toMatch(/sandbox/);
    expect(JSON.stringify(counters)).toMatch(/production/);
  });

  test('initialize seeds a new counter in issuer context', async () => {
    await sequentialService.initialize(fx.A.issuerId, '001', '001', '04', 50, false);
    const { rows } = await db.queryAsIssuer(
      fx.A.issuerId, "SELECT current_value FROM sequential_numbers WHERE document_type = '04'", [], false);
    expect(Number(rows[0].current_value)).toBe(49);
  });

  test('admin payments list resolves invoice_access_key from either schema', async () => {
    await rlsContext.runAsSystem(async () => {
      const paymentModel = require('../../src/models/payment.model');
      const { rows: [sub] } = await db.query(
        `INSERT INTO subscriptions (tenant_id, tier, billing_interval, status) VALUES ($1, 'STARTER', 'MONTHLY', 'ACTIVE') RETURNING id`,
        [fx.A.tenantId]);
      const { rows: [payment] } = await db.query(
        `INSERT INTO payments (subscription_id, amount, iva_rate, iva_amount, total_amount, status, purpose, invoice_document_id)
         VALUES ($1, 10, 0.15, 1.5, 11.5, 'VERIFIED', 'INITIAL', $2) RETURNING id`,
        [sub.id, fx.A.docs.public.id]);
      try {
        const rows = await paymentModel.findAllByStatus('VERIFIED');
        expect(rows.find((r) => r.id === payment.id).invoice_access_key).toBe(fx.A.docs.public.access_key);
      } finally {
        await db.query('DELETE FROM payments WHERE id = $1', [payment.id]);
        await db.query('DELETE FROM subscriptions WHERE id = $1', [sub.id]);
      }
    });
  });

  test('migration runner connection can modify RLS tables', async () => {
    // Mirrors what db/migrate.js must do: session-level system context.
    const client = await pool.connect();
    try {
      await client.query("SET app.rls_system = 'on'");
      const { rowCount } = await client.query(
        'UPDATE public.documents SET updated_at = updated_at WHERE issuer_id = ANY($1)', [[fx.A.issuerId, fx.B.issuerId]]);
      expect(rowCount).toBeGreaterThanOrEqual(2);
    } finally {
      await client.query('RESET app.rls_system');
      client.release();
    }
  });

  // End-to-end HTTP flows (documents, issuers, keys, billing, admin, worker)
  // live in http-two-tenants.test.js.
});
