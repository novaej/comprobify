/**
 * Gate for the fail-closed RLS rollout (docs/plans/rls-fail-closed.md).
 *
 * Runs against a real Postgres with all migrations applied, connected as the
 * non-superuser app role. Refuses to run unless DB_NAME ends in "_test".
 * Expected to FAIL until migration 105 and the db helpers exist.
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
const SCHEMAS = ['public', 'sandbox'];
const TABLES = ['documents', 'document_line_items', 'document_events', 'sequential_numbers', 'sri_responses'];
const PROTECTED = SCHEMAS.flatMap((s) => TABLES.map((t) => `${s}.${t}`));

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
const noContext = (fn) => inTx([], fn);
const count = async (client, table, where = 'true', params = []) =>
  Number((await client.query(`SELECT count(*) FROM ${table} WHERE ${where}`, params)).rows[0].count);

const fx = { tenants: [], issuers: {}, docs: {} };

async function seedIssuer(client, label) {
  const { rows: [tenant] } = await client.query(
    'INSERT INTO tenants (email) VALUES ($1) RETURNING id', [`rls-${label}-${digits(8)}@example.test`]);
  const { rows: [issuer] } = await client.query(
    `INSERT INTO issuers (tenant_id, ruc, business_name, main_address, branch_address, branch_code, issue_point_code)
     VALUES ($1, $2, $3, 'Main St', 'Main St', '001', '001') RETURNING id`,
    [tenant.id, digits(13), `RLS Test ${label}`]);
  fx.tenants.push(tenant.id);
  fx.issuers[label] = issuer.id;
  fx.docs[label] = {};

  for (const schema of SCHEMAS) {
    const { rows: [doc] } = await client.query(
      `INSERT INTO ${schema}.documents (issuer_id, document_type, access_key, sequential, branch_code, issue_point_code, issue_date, email_message_id)
       VALUES ($1, '01', $2, 1, '001', '001', CURRENT_DATE, $3) RETURNING id, access_key, email_message_id`,
      [issuer.id, digits(49), `msg-${digits(12)}@mg.test`]);
    await client.query(
      `INSERT INTO ${schema}.document_line_items (document_id, main_code, description, quantity, unit_price, subtotal, taxes, line_total)
       VALUES ($1, 'P1', 'Item', 1, 10, 10, '[]', 10)`, [doc.id]);
    await client.query(
      `INSERT INTO ${schema}.document_events (document_id, event_type) VALUES ($1, 'CREATED')`, [doc.id]);
    await client.query(
      `INSERT INTO ${schema}.sri_responses (document_id, operation_type) VALUES ($1, 'RECEPTION')`, [doc.id]);
    await client.query(
      `INSERT INTO ${schema}.sequential_numbers (issuer_id, branch_code, issue_point_code, document_type, current_value)
       VALUES ($1, '001', '001', '01', 1)`, [issuer.id]);
    fx.docs[label][schema] = doc;
  }
}

// Column that ties a row in `table` to an issuer's fixture document.
const ownedBy = (schema, table, label) =>
  (table === 'documents'
    ? ['id = $1', [fx.docs[label][schema].id]]
    : table === 'sequential_numbers'
      ? ['issuer_id = $1', [fx.issuers[label]]]
      : ['document_id = $1', [fx.docs[label][schema].id]]);

beforeAll(async () => {
  await asSystem(async (client) => {
    await seedIssuer(client, 'A');
    await seedIssuer(client, 'B');
  });
});

afterAll(async () => {
  await asSystem(async (client) => {
    const ids = Object.values(fx.issuers);
    for (const schema of SCHEMAS) {
      for (const table of ['sri_responses', 'document_events', 'document_line_items']) {
        await client.query(
          `DELETE FROM ${schema}.${table} WHERE document_id IN (SELECT id FROM ${schema}.documents WHERE issuer_id = ANY($1))`, [ids]);
      }
      await client.query(`DELETE FROM ${schema}.documents WHERE issuer_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM ${schema}.sequential_numbers WHERE issuer_id = ANY($1)`, [ids]);
    }
    await client.query('DELETE FROM issuers WHERE id = ANY($1)', [ids]);
    await client.query('DELETE FROM tenants WHERE id = ANY($1)', [fx.tenants]);
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

  test.each(PROTECTED)('%s has RLS enabled and forced', async (qualified) => {
    const { rows: [row] } = await pool.query(
      'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass', [qualified]);
    expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  test.each(PROTECTED)('%s has a policy with an explicit WITH CHECK and no null bypass', async (qualified) => {
    const [schema, table] = qualified.split('.');
    const { rows } = await pool.query(
      'SELECT qual, with_check FROM pg_policies WHERE schemaname = $1 AND tablename = $2', [schema, table]);
    expect(rows.length).toBeGreaterThan(0);
    for (const policy of rows) {
      expect(policy.with_check).not.toBeNull();
      expect(`${policy.qual} ${policy.with_check}`).not.toMatch(/IS NULL/i);
    }
  });

  test('sandbox child policies reference sandbox.documents, not public', async () => {
    const { rows } = await pool.query(
      `SELECT tablename, qual FROM pg_policies
       WHERE schemaname = 'sandbox' AND tablename IN ('document_line_items', 'document_events', 'sri_responses')`);
    expect(rows).toHaveLength(3);
    for (const policy of rows) expect(policy.qual).toMatch(/sandbox\.documents/);
  });

  test('no table with an issuer_id or document_id column is left without RLS', async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT c.table_schema || '.' || c.table_name AS t
       FROM information_schema.columns c
       JOIN pg_class k ON k.oid = (c.table_schema || '.' || c.table_name)::regclass
       WHERE c.table_schema IN ('public', 'sandbox')
         AND c.column_name IN ('issuer_id', 'document_id')
         AND k.relkind = 'r' AND NOT k.relrowsecurity`);
    // Known Phase 2 tables; anything else here is a new table that skipped RLS.
    const phase2 = ['public.issuer_document_types', 'public.notifications', 'public.pending_effects'];
    expect(rows.map((r) => r.t).filter((t) => !phase2.includes(t))).toEqual([]);
  });
});

describe('no context: fails closed', () => {
  test.each(PROTECTED)('%s: SELECT sees nothing', async (qualified) => {
    expect(await noContext((c) => count(c, qualified))).toBe(0);
  });

  test.each(PROTECTED)('%s: UPDATE and DELETE touch nothing', async (qualified) => {
    const [schema, table] = qualified.split('.');
    const [where, params] = ownedBy(schema, table, 'A');
    const touched = await noContext(async (c) => {
      const upd = await c.query(`UPDATE ${qualified} SET id = id WHERE ${where}`, params);
      const del = await c.query(`DELETE FROM ${qualified} WHERE ${where}`, params);
      return upd.rowCount + del.rowCount;
    });
    expect(touched).toBe(0);
    expect(await asSystem((c) => count(c, qualified, where, params))).toBeGreaterThan(0);
  });

  test.each(SCHEMAS)('%s: INSERT is rejected on every table', async (schema) => {
    const doc = fx.docs.A[schema];
    const inserts = [
      [`INSERT INTO ${schema}.documents (issuer_id, document_type, access_key, sequential, branch_code, issue_point_code, issue_date)
        VALUES ($1, '01', $2, 2, '001', '001', CURRENT_DATE)`, [fx.issuers.A, digits(49)]],
      [`INSERT INTO ${schema}.document_events (document_id, event_type) VALUES ($1, 'CREATED')`, [doc.id]],
      [`INSERT INTO ${schema}.sri_responses (document_id, operation_type) VALUES ($1, 'RECEPTION')`, [doc.id]],
      [`INSERT INTO ${schema}.document_line_items (document_id, main_code, description, quantity, unit_price, subtotal, taxes, line_total)
        VALUES ($1, 'P1', 'Item', 1, 10, 10, '[]', 10)`, [doc.id]],
      [`INSERT INTO ${schema}.sequential_numbers (issuer_id, branch_code, issue_point_code, document_type, current_value)
        VALUES ($1, '001', '001', '04', 0)`, [fx.issuers.A]],
    ];
    for (const [sql, params] of inserts) {
      await expect(noContext((c) => c.query(sql, params))).rejects.toMatchObject({ code: RLS_VIOLATION });
    }
  });

  test('an empty-string context is treated as no context', async () => {
    expect(await inTx([['app.current_issuer_id', '']], (c) => count(c, 'public.documents'))).toBe(0);
  });

  test('a malformed context never widens access', async () => {
    const attempt = inTx([['app.current_issuer_id', 'not-a-uuid']], (c) => count(c, 'public.documents'));
    await expect(attempt.then((n) => n === 0, () => true)).resolves.toBe(true);
  });

  test('rls_system only accepts the exact value "on"', async () => {
    for (const value of ['true', '1', 'ON ', 'off', '']) {
      expect(await inTx([['app.rls_system', value]], (c) => count(c, 'public.documents'))).toBe(0);
    }
  });
});

describe('issuer context: sees only its own rows', () => {
  test.each(PROTECTED)('%s: A sees A, never B', async (qualified) => {
    const [schema, table] = qualified.split('.');
    const [ownWhere, ownParams] = ownedBy(schema, table, 'A');
    const [otherWhere, otherParams] = ownedBy(schema, table, 'B');
    const [own, other] = await asIssuer(fx.issuers.A, async (c) => [
      await count(c, qualified, ownWhere, ownParams),
      await count(c, qualified, otherWhere, otherParams),
    ]);
    expect(own).toBeGreaterThan(0);
    expect(other).toBe(0);
  });

  test.each(SCHEMAS)('%s: A cannot update or delete B rows', async (schema) => {
    const touched = await asIssuer(fx.issuers.A, async (c) => {
      const upd = await c.query(`UPDATE ${schema}.documents SET buyer_name = 'x' WHERE id = $1`, [fx.docs.B[schema].id]);
      const del = await c.query(`DELETE FROM ${schema}.document_events WHERE document_id = $1`, [fx.docs.B[schema].id]);
      const seq = await c.query(`UPDATE ${schema}.sequential_numbers SET current_value = 999 WHERE issuer_id = $1`, [fx.issuers.B]);
      return upd.rowCount + del.rowCount + seq.rowCount;
    });
    expect(touched).toBe(0);
  });

  test.each(SCHEMAS)('%s: A cannot insert rows owned by B', async (schema) => {
    await expect(asIssuer(fx.issuers.A, (c) => c.query(
      `INSERT INTO ${schema}.documents (issuer_id, document_type, access_key, sequential, branch_code, issue_point_code, issue_date)
       VALUES ($1, '01', $2, 3, '001', '001', CURRENT_DATE)`, [fx.issuers.B, digits(49)],
    ))).rejects.toMatchObject({ code: RLS_VIOLATION });
    await expect(asIssuer(fx.issuers.A, (c) => c.query(
      `INSERT INTO ${schema}.document_events (document_id, event_type) VALUES ($1, 'CREATED')`, [fx.docs.B[schema].id],
    ))).rejects.toMatchObject({ code: RLS_VIOLATION });
    await expect(asIssuer(fx.issuers.A, (c) => c.query(
      `INSERT INTO ${schema}.sri_responses (document_id, operation_type) VALUES ($1, 'RECEPTION')`, [fx.docs.B[schema].id],
    ))).rejects.toMatchObject({ code: RLS_VIOLATION });
  });

  test.each(SCHEMAS)('%s: A cannot move its own rows to B', async (schema) => {
    // WITH CHECK rejects the new row; sequential_numbers has no other guard.
    await expect(asIssuer(fx.issuers.A, (c) => c.query(
      `UPDATE ${schema}.sequential_numbers SET issuer_id = $1, document_type = '07' WHERE issuer_id = $2`,
      [fx.issuers.B, fx.issuers.A],
    ))).rejects.toMatchObject({ code: RLS_VIOLATION });
    // documents.issuer_id is also immutable by trigger (migration 026), which fires first.
    await expect(asIssuer(fx.issuers.A, (c) => c.query(
      `UPDATE ${schema}.documents SET issuer_id = $1 WHERE id = $2`, [fx.issuers.B, fx.docs.A[schema].id],
    ))).rejects.toThrow();
  });

  test.each(SCHEMAS)('%s: A can write its own rows', async (schema) => {
    await asIssuer(fx.issuers.A, async (c) => {
      const ev = await c.query(
        `INSERT INTO ${schema}.document_events (document_id, event_type) VALUES ($1, 'SENT') RETURNING id`, [fx.docs.A[schema].id]);
      const upd = await c.query(`UPDATE ${schema}.documents SET buyer_name = 'ok' WHERE id = $1`, [fx.docs.A[schema].id]);
      expect(ev.rows).toHaveLength(1);
      expect(upd.rowCount).toBe(1);
    });
  });
});

describe('system context', () => {
  test.each(PROTECTED)('%s: sees both issuers', async (qualified) => {
    const [schema, table] = qualified.split('.');
    const [aWhere, aParams] = ownedBy(schema, table, 'A');
    const [bWhere, bParams] = ownedBy(schema, table, 'B');
    const [a, b] = await asSystem(async (c) => [
      await count(c, qualified, aWhere, aParams), await count(c, qualified, bWhere, bParams)]);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });

  test('context does not leak to the next transaction on the same connection', async () => {
    const client = await pool.connect();
    try {
      for (const [key, value] of [['app.rls_system', 'on'], ['app.current_issuer_id', fx.issuers.A]]) {
        await client.query('BEGIN');
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
        expect(await count(client, 'public.documents')).toBeGreaterThan(0);
        await client.query('COMMIT');
        expect(await count(client, 'public.documents')).toBe(0);
      }
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.rls_system', 'on', true)");
      await client.query('ROLLBACK');
      expect(await count(client, 'public.documents')).toBe(0);
    } finally {
      client.release();
    }
  });
});

describe('integrity checks still work under RLS', () => {
  test('access_key uniqueness is enforced across issuers', async () => {
    await expect(asIssuer(fx.issuers.B, (c) => c.query(
      `INSERT INTO public.documents (issuer_id, document_type, access_key, sequential, branch_code, issue_point_code, issue_date)
       VALUES ($1, '01', $2, 9, '001', '001', CURRENT_DATE)`, [fx.issuers.B, fx.docs.A.public.access_key],
    ))).rejects.toMatchObject({ code: '23505' });
  });

  test('issuer FK check sees issuers regardless of context', async () => {
    await expect(asSystem((c) => c.query(
      `INSERT INTO public.documents (issuer_id, document_type, access_key, sequential, branch_code, issue_point_code, issue_date)
       VALUES ($1, '01', $2, 9, '001', '001', CURRENT_DATE)`, [crypto.randomUUID(), digits(49)],
    ))).rejects.toMatchObject({ code: '23503' });
  });
});

// Everything below goes through the real app code that used to rely on the bypass.
describe('application code paths', () => {
  const db = require('../../src/config/database');
  const documentModel = require('../../src/models/document.model');
  const documentEventModel = require('../../src/models/document-event.model');
  const sriResponseModel = require('../../src/models/sri-response.model');
  const sequentialService = require('../../src/services/sequential.service');

  test('db.query() with no context sees no documents', async () => {
    const { rows } = await db.query('SELECT count(*)::int AS n FROM public.documents');
    expect(rows[0].n).toBe(0);
  });

  test('db.queryAsIssuer scopes to the issuer and routes to the right schema', async () => {
    for (const [sandbox, schema] of [[false, 'public'], [true, 'sandbox']]) {
      const { rows } = await db.queryAsIssuer(fx.issuers.A, 'SELECT id FROM documents', [], sandbox);
      expect(rows.map((r) => r.id)).toEqual([fx.docs.A[schema].id]);
    }
  });

  test('db.queryAsSystem sees every issuer and does not leak', async () => {
    const { rows } = await db.queryAsSystem(
      'SELECT count(*)::int AS n FROM public.documents WHERE issuer_id = ANY($1)', [Object.values(fx.issuers)]);
    expect(rows[0].n).toBe(2);
    const after = await db.query('SELECT count(*)::int AS n FROM public.documents');
    expect(after.rows[0].n).toBe(0);
  });

  test('concurrent issuer queries never see each other\'s rows', async () => {
    const run = (label) => db.queryAsIssuer(fx.issuers[label], 'SELECT issuer_id FROM documents', [], false)
      .then(({ rows }) => rows.every((r) => r.issuer_id === fx.issuers[label]) && rows.length === 1);
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => run(i % 2 ? 'A' : 'B')));
    expect(results.every(Boolean)).toBe(true);
  });

  describe.each([[false, 'public'], [true, 'sandbox']])('sandbox=%s', (sandbox, schema) => {
    test('findByAccessKey: own issuer finds it, other issuer does not', async () => {
      const key = fx.docs.A[schema].access_key;
      expect(await documentModel.findByAccessKey(key, fx.issuers.A, sandbox)).toMatchObject({ id: fx.docs.A[schema].id });
      expect(await documentModel.findByAccessKey(key, fx.issuers.B, sandbox)).toBeFalsy();
    });

    test('findByAccessKey with no issuer (admin link-invoice, admin RIDE) still finds it', async () => {
      const doc = await documentModel.findByAccessKey(fx.docs.A[schema].access_key);
      expect(doc).toMatchObject({ id: fx.docs.A[schema].id, sandbox });
    });

    test('Mailgun webhook: lookup by message id, status update, event write', async () => {
      const found = await documentModel.findByEmailMessageId(fx.docs.A[schema].email_message_id);
      expect(found).toMatchObject({ id: fx.docs.A[schema].id, sandbox });

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
        documentId: fx.docs.A[schema].id, operationType: 'AUTHORIZATION', status: 'AUTORIZADO',
        messages: [], rawResponse: '<x/>', sandbox, issuerId: fx.issuers.A,
      });
      expect(created).toMatchObject({ document_id: fx.docs.A[schema].id });
      const rows = await sriResponseModel.findByDocumentId(fx.docs.A[schema].id, sandbox, fx.issuers.A);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(await sriResponseModel.findByDocumentId(fx.docs.A[schema].id, sandbox, fx.issuers.B)).toEqual([]);
    });

    test('document events: read is issuer scoped', async () => {
      expect((await documentEventModel.findByDocumentId(fx.docs.A[schema].id, fx.issuers.A, sandbox)).length).toBeGreaterThan(0);
      expect(await documentEventModel.findByDocumentId(fx.docs.A[schema].id, fx.issuers.B, sandbox)).toEqual([]);
    });

    test('updateStatus: other issuer cannot move the document', async () => {
      const result = await documentModel.updateStatus(fx.docs.A[schema].id, 'SIGNED', { buyer_name: 'hijack' }, fx.issuers.B, sandbox);
      expect(result).toBeFalsy();
    });

    test('sequentials: getNext increments only the caller\'s counter', async () => {
      const before = await asSystem((c) => c.query(
        `SELECT current_value FROM ${schema}.sequential_numbers WHERE issuer_id = $1`, [fx.issuers.B]));
      const next = await sequentialService.getNext(fx.issuers.A, '001', '001', '01', null, sandbox);
      expect(Number(next)).toBeGreaterThan(1);
      const after = await asSystem((c) => c.query(
        `SELECT current_value FROM ${schema}.sequential_numbers WHERE issuer_id = $1`, [fx.issuers.B]));
      expect(after.rows).toEqual(before.rows);
    });
  });

  test('existsByIssuerId sees documents in either schema', async () => {
    expect(await documentModel.existsByIssuerId(fx.issuers.A)).toBe(true);
  });

  test('getCounters reads both schemas for one issuer', async () => {
    const counters = await sequentialService.getCounters(fx.issuers.A, ['01']);
    expect(JSON.stringify(counters)).toMatch(/sandbox/);
    expect(JSON.stringify(counters)).toMatch(/production/);
  });

  test('initialize seeds a new counter in issuer context', async () => {
    await sequentialService.initialize(fx.issuers.A, '001', '001', '04', 50, false);
    const { rows } = await db.queryAsIssuer(
      fx.issuers.A, "SELECT current_value FROM sequential_numbers WHERE document_type = '04'", [], false);
    expect(Number(rows[0].current_value)).toBe(49);
  });

  test('admin payments list resolves invoice_access_key from either schema', async () => {
    const paymentModel = require('../../src/models/payment.model');
    const { rows: [sub] } = await db.query(
      `INSERT INTO subscriptions (tenant_id, tier, billing_interval, status) VALUES ($1, 'STARTER', 'MONTHLY', 'ACTIVE') RETURNING id`,
      [fx.tenants[0]]);
    const { rows: [payment] } = await db.query(
      `INSERT INTO payments (subscription_id, amount, iva_rate, iva_amount, total_amount, status, purpose, invoice_document_id)
       VALUES ($1, 10, 0.15, 1.5, 11.5, 'VERIFIED', 'INITIAL', $2) RETURNING id`,
      [sub.id, fx.docs.A.public.id]);
    try {
      const rows = await paymentModel.findAllByStatus('VERIFIED');
      expect(rows.find((r) => r.id === payment.id).invoice_access_key).toBe(fx.docs.A.public.access_key);
    } finally {
      await db.query('DELETE FROM payments WHERE id = $1', [payment.id]);
      await db.query('DELETE FROM subscriptions WHERE id = $1', [sub.id]);
    }
  });

  test('migration runner connection can modify RLS tables', async () => {
    // Mirrors what db/migrate.js must do: session-level system context.
    const client = await pool.connect();
    try {
      await client.query("SET app.rls_system = 'on'");
      const { rowCount } = await client.query(
        'UPDATE public.documents SET updated_at = updated_at WHERE issuer_id = ANY($1)', [Object.values(fx.issuers)]);
      expect(rowCount).toBe(2);
    } finally {
      await client.query('RESET app.rls_system');
      client.release();
    }
  });

  // Need the HTTP app, RabbitMQ and SRI mock mode; run as staging smoke tests
  // until an end-to-end harness exists. See the plan's pre-production checklist.
  test.todo('POST /v1/documents → send → authorize in sandbox reaches AUTHORIZED (worker writes sri_responses)');
  test.todo('same flow for a promoted tenant in the public schema');
  test.todo('X-Issuer-Id of another tenant returns 403 and reads nothing');
  test.todo('POST /:key/rebuild replaces line items inside one issuer transaction');
  test.todo('POST /:key/void writes the VOIDED event');
  test.todo('GET /:key/credit-notes sums only this issuer\'s credit notes');
  test.todo('Idempotency-Key replay returns the same document; concurrent race resolves via 23505');
  test.todo('POST /v1/mailgun/webhook with a valid signature updates email_status');
  test.todo('PATCH /v1/admin/subscriptions/:id/link-invoice works for sandbox and production access keys');
  test.todo('GET admin RIDE by access key returns a PDF');
  test.todo('POST /v1/tenants/promote seeds production sequentials');
  test.todo('DELETE /v1/issuers/:id refuses an issuer with documents');
  test.todo('every /v1/admin/jobs/* endpoint completes without a 42501');
});
