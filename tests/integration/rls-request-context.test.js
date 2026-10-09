/**
 * The request context (rls-context.js) reaching Postgres through db.query()
 * and the transaction helpers. Real database, no policies involved — this
 * only proves the right settings are in force for the right query.
 *
 *   DB_NAME=comprobify_test npm run test:integration
 */

require('dotenv').config({ quiet: true });

const config = require('../../src/config');

if (!/_test$/.test(config.db.database)) {
  throw new Error(`Refusing to run integration tests against "${config.db.database}" (DB_NAME must end in _test)`);
}

const db = require('../../src/config/database');
const rlsContext = require('../../src/config/rls-context');
const logger = require('../../src/services/logger.service');

const TENANT_A = '00000000-0000-0000-0000-0000000000aa';
const TENANT_B = '00000000-0000-0000-0000-0000000000bb';
const ISSUER = '00000000-0000-0000-0000-0000000000cc';

const SETTINGS = `SELECT
  NULLIF(current_setting('app.current_tenant_id', true), '') AS tenant,
  NULLIF(current_setting('app.current_issuer_id', true), '') AS issuer,
  NULLIF(current_setting('app.rls_system', true), '')        AS system,
  current_setting('search_path')                              AS search_path`;

const settings = async (run = (sql) => db.query(sql)) => (await run(SETTINGS)).rows[0];

afterAll(() => db.pool.end());

describe('db.query() applies the current context', () => {
  test('no context: nothing is set', async () => {
    expect(await settings()).toMatchObject({ tenant: null, issuer: null, system: null });
  });

  test('tenant context sets the tenant and nothing else', async () => {
    const row = await rlsContext.runAsTenant(TENANT_A, () => settings());
    expect(row).toMatchObject({ tenant: TENANT_A, issuer: null, system: null });
  });

  test('system context sets the system flag and no tenant', async () => {
    const row = await rlsContext.runAsSystem(() => settings());
    expect(row).toMatchObject({ tenant: null, issuer: null, system: 'on' });
  });

  test('the innermost context wins, and the outer one is restored afterwards', async () => {
    await rlsContext.runAsSystem(async () => {
      expect(await rlsContext.runAsTenant(TENANT_A, () => settings())).toMatchObject({ tenant: TENANT_A, system: null });
      expect(await settings()).toMatchObject({ tenant: null, system: 'on' });
    });
    await rlsContext.runAsTenant(TENANT_A, async () => {
      expect(await rlsContext.runAsSystem(() => settings())).toMatchObject({ tenant: null, system: 'on' });
      expect(await settings()).toMatchObject({ tenant: TENANT_A, system: null });
    });
  });

  test('context survives awaits, timers and un-awaited work started inside it', async () => {
    let fireAndForget;
    await rlsContext.runAsTenant(TENANT_A, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      fireAndForget = new Promise((resolve) => setImmediate(() => resolve(settings())));
    });
    expect(await fireAndForget).toMatchObject({ tenant: TENANT_A });
  });

  test('nothing leaks to later queries on the same pooled connections', async () => {
    await Promise.all(Array.from({ length: 10 }, () => rlsContext.runAsSystem(() => settings())));
    const after = await Promise.all(Array.from({ length: 10 }, () => settings()));
    for (const row of after) expect(row).toMatchObject({ tenant: null, issuer: null, system: null });
  });

  test('concurrent requests for different tenants never see each other\'s context', async () => {
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => {
      const tenant = i % 2 ? TENANT_A : TENANT_B;
      return rlsContext.runAsTenant(tenant, async () => (await settings()).tenant === tenant);
    }));
    expect(results.every(Boolean)).toBe(true);
  });

  test('a failing query rolls back and still releases a clean connection', async () => {
    await expect(rlsContext.runAsTenant(TENANT_A, () => db.query('SELECT 1/0'))).rejects.toThrow();
    expect(await settings()).toMatchObject({ tenant: null, system: null });
  });

  test('a failing query surfaces its own error, not the aborted-transaction one, and leaves no transaction open', async () => {
    // The wrapper pipelines BEGIN / set_config / query / COMMIT; the trailing COMMIT must end the aborted transaction.
    for (const run of [
      () => rlsContext.runAsTenant(TENANT_A, () => db.query('SELECT 1/0')),
      () => rlsContext.runAsSystem(() => db.query('SELECT 1/0')),
      () => db.queryAsIssuer(ISSUER, 'SELECT 1/0', [], true),
      () => db.queryAsSystem('SELECT 1/0'),
    ]) {
      await expect(run()).rejects.toMatchObject({ code: '22012' });
    }
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = current_user AND datname = current_database() AND state LIKE 'idle in transaction%'");
    expect(rows[0].n).toBe(0);
    expect(await settings()).toMatchObject({ tenant: null, issuer: null, system: null });
    expect((await settings()).search_path).not.toMatch(/sandbox/);
  });

  test('a burst larger than the pool still returns every caller its own rows', async () => {
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) =>
      rlsContext.runAsTenant(i % 2 ? TENANT_A : TENANT_B, () => db.query('SELECT $1::int AS n, current_setting(\'app.current_tenant_id\', true) AS tenant', [i]))
        .then(({ rows }) => rows[0].n === i && rows[0].tenant === (i % 2 ? TENANT_A : TENANT_B))));
    expect(results.every(Boolean)).toBe(true);
  });

  test('results and parameters pass through unchanged', async () => {
    const { rows, rowCount } = await rlsContext.runAsTenant(TENANT_A, () => db.query('SELECT $1::int + 1 AS n', [41]));
    expect(rows).toEqual([{ n: 42 }]);
    expect(rowCount).toBe(1);
  });
});

describe('explicit transactions', () => {
  const inTx = async (setup) => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setup(client);
      const during = (await client.query(SETTINGS)).rows[0];
      await client.query('COMMIT');
      const after = (await client.query(SETTINGS)).rows[0];
      return { during, after };
    } finally {
      client.release();
    }
  };

  test('applyContext carries the tenant into the transaction, and COMMIT clears it', async () => {
    const { during, after } = await rlsContext.runAsTenant(TENANT_A, () => inTx((c) => db.applyContext(c)));
    expect(during).toMatchObject({ tenant: TENANT_A, system: null });
    expect(after).toMatchObject({ tenant: null, system: null });
  });

  test('applyContext carries system context', async () => {
    const { during } = await rlsContext.runAsSystem(() => inTx((c) => db.applyContext(c)));
    expect(during).toMatchObject({ tenant: null, system: 'on' });
  });

  test('setIssuerContext adds the issuer and schema and inherits the tenant', async () => {
    const { during, after } = await rlsContext.runAsTenant(TENANT_A, () => inTx((c) => db.setIssuerContext(c, ISSUER, true)));
    expect(during).toMatchObject({ tenant: TENANT_A, issuer: ISSUER, system: null });
    expect(during.search_path).toMatch(/^sandbox, public$/);
    expect(after).toMatchObject({ tenant: null, issuer: null });
    expect(after.search_path).not.toMatch(/sandbox/);
  });

  test('issuer context never inherits system reach', async () => {
    const row = await rlsContext.runAsSystem(() => settings((sql) => db.queryAsIssuer(ISSUER, sql, [], false)));
    expect(row).toMatchObject({ tenant: null, issuer: ISSUER, system: null });
  });

  test('queryAsSystem ignores an ambient tenant', async () => {
    const row = await rlsContext.runAsTenant(TENANT_A, () => settings((sql) => db.queryAsSystem(sql)));
    expect(row).toMatchObject({ tenant: null, issuer: null, system: 'on' });
  });
});

describe('shadow mode', () => {
  let warn;
  beforeEach(() => { warn = jest.spyOn(logger, 'warn').mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());

  const missing = () => warn.mock.calls.filter(([message]) => message === 'rls_context_missing');

  test('a context-free query on a tenant-owned table is reported, with where it came from', async () => {
    await db.query('SELECT count(*) FROM tenants');
    expect(missing()).toHaveLength(1);
    expect(missing()[0][1]).toMatchObject({ kind: 'query', table: 'tenants' });
    expect(missing()[0][1].site).toMatch(/rls-request-context\.test\.js/);
  });

  test('a repeated call site does not flood the log', async () => {
    for (let i = 0; i < 20; i += 1) await db.query('SELECT count(*) FROM issuers');
    // The first, synchronous call can carry one extra caller frame.
    expect(missing().length).toBeGreaterThanOrEqual(1);
    expect(missing().length).toBeLessThanOrEqual(2);
  });

  test('global tables and context-free statements are not reported', async () => {
    await db.query('SELECT count(*) FROM tier_prices');
    await db.query('SELECT count(*) FROM notification_email_templates');
    await db.query('SELECT 1');
    expect(missing()).toHaveLength(0);
  });

  test('a query with a context is not reported', async () => {
    await rlsContext.runAsTenant(TENANT_A, () => db.query('SELECT count(*) FROM api_keys'));
    await rlsContext.runAsSystem(() => db.query('SELECT count(*) FROM payments'));
    expect(missing()).toHaveLength(0);
  });

  test('a transaction that applies no context is reported', async () => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await db.applyContext(client);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(missing()).toHaveLength(1);
    expect(missing()[0][1]).toMatchObject({ kind: 'transaction' });
  });
});
