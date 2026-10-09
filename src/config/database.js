const { Pool } = require('pg');
const config = require('./index');
const rlsContext = require('./rls-context');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  ssl: config.db.ssl,
  max: config.db.poolMax,
  // Lets the context wrapper below send BEGIN / set_config / query / COMMIT
  // in one network flush. Code that awaits each query in turn is unaffected.
  pipeline: true,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

// Tables whose rows belong to a tenant or issuer. Used only to decide whether a
// context-free query is worth a shadow-mode warning — never for enforcement.
const TENANT_OWNED_TABLES = /\b(tenants|issuers|api_keys|api_key_daily_usage|issuer_document_types|tenant_events|tenant_quotas|tenant_agreements|notifications|notification_preferences|webhook_endpoints|webhook_deliveries|subscriptions|payments|payment_proofs|payphone_transactions|pending_effects|documents|document_line_items|document_events|sequential_numbers|sri_responses)\b/;

const warnedSites = new Set();

// Shadow mode (ADR-037): report a query that would fail once tenant-level
// policies are enforced. Logged once per call site per process.
const warnMissingContext = (kind, text) => {
  // The first frame is usually a model; the next few say which request or job reached it.
  const frames = (new Error().stack || '').split('\n').slice(2)
    .filter((line) => !line.includes('config/database.js') && !line.includes('node_modules') && !line.includes('node:'))
    .slice(0, 4)
    .map((line) => line.trim().replace(/^at (async )?/, ''));
  // Keyed on the query site plus its immediate caller: stable across calls,
  // and still separates two different paths reaching the same model function.
  const key = `${frames[0] || 'unknown'} < ${frames[1] || ''}`;
  if (warnedSites.has(key)) return;
  warnedSites.add(key);
  const match = text ? text.match(TENANT_OWNED_TABLES) : null;
  // Lazy: the logger reads config at load time, and this module is required first.
  require('../services/logger.service').warn('rls_context_missing', {
    kind,
    table: match ? match[1] : null,
    site: frames[0] || 'unknown',
    callers: frames.slice(1),
  });
};

// Each returns the query promise without awaiting it, so callers can pipeline.
const setConfig = (client, { tenantId = '', system = false, issuerId = '' }) => client.query(
  "SELECT set_config('app.current_tenant_id', $1, true), set_config('app.rls_system', $2, true), set_config('app.current_issuer_id', $3, true)",
  [tenantId, system ? 'on' : '', issuerId]
);

const setIssuerConfig = (client, issuerId, sandbox) => client.query(
  "SELECT set_config('app.current_tenant_id', $1, true), set_config('app.rls_system', '', true), set_config('app.current_issuer_id', $2, true), set_config('search_path', $3, true)",
  [rlsContext.current()?.tenantId || '', String(issuerId), sandbox ? 'sandbox, public' : 'public']
);

// One query in its own transaction with a context set first. All four
// statements are queued before any reply is awaited (pipelined), so this
// costs one round-trip. If the query fails the transaction is aborted and
// the trailing COMMIT ends it as a rollback.
const inTransaction = async (setContext, text, params) => {
  const client = await pool.connect();
  try {
    const settled = await Promise.allSettled([
      client.query('BEGIN'),
      setContext(client),
      client.query(text, params),
      client.query('COMMIT'),
    ]);
    const failed = settled.find((outcome) => outcome.status === 'rejected');
    if (failed) throw failed.reason;
    return settled[2].value;
  } finally {
    client.release();
  }
};

/**
 * Run a single parameterised query as whoever the current request or job is
 * acting for (see rls-context.js). With no context it runs bare — fine for
 * global tables, and a shadow-mode warning for tenant-owned ones.
 */
const query = (text, params) => {
  const ctx = rlsContext.current();
  if (!ctx) {
    if (TENANT_OWNED_TABLES.test(text)) warnMissingContext('query', text);
    return pool.query(text, params);
  }
  return inTransaction((client) => setConfig(client, ctx), text, params);
};

const getClient = () => pool.connect();

/**
 * Apply the current request/job context to an explicit transaction. Call
 * right after BEGIN on any transaction that touches tenant-owned tables.
 *
 * @param {import('pg').PoolClient} client
 */
const applyContext = async (client) => {
  const ctx = rlsContext.current();
  if (!ctx) {
    warnMissingContext('transaction');
    return;
  }
  await setConfig(client, ctx);
};

/**
 * Set the transaction-local issuer context on an existing client.
 * Must be called after BEGIN so every setting is automatically rolled back
 * if the transaction aborts.
 *
 * Sets:
 *   - app.current_issuer_id  — enforced by RLS policies
 *   - app.current_tenant_id  — inherited from the current tenant context, so
 *                              the same transaction can touch tenant tables
 *   - search_path            — routes unqualified table names to the correct
 *                              schema (sandbox vs public) for the request
 *
 * Never inherits system context: issuer-scoped work stays issuer-scoped.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} issuerId
 * @param {boolean} [sandbox=false]
 */
const setIssuerContext = (client, issuerId, sandbox = false) => setIssuerConfig(client, issuerId, sandbox);

/**
 * Run a single parameterised query with the RLS issuer context set.
 * Opens a mini-transaction, sets the context and search_path, runs the query,
 * and commits. Use this for non-transactional model queries in authenticated
 * code paths.
 *
 * @param {string} issuerId
 * @param {string} text
 * @param {Array} [params]
 * @param {boolean} [sandbox=false]
 */
const queryAsIssuer = (issuerId, text, params, sandbox = false) =>
  inTransaction((client) => setIssuerConfig(client, issuerId, sandbox), text, params);

/**
 * Set the transaction-local system context on an existing client: RLS
 * policies let it see every issuer's rows. Must be called after BEGIN.
 * Does not touch search_path — qualify sandbox tables explicitly.
 *
 * @param {import('pg').PoolClient} client
 */
const setSystemContext = (client) => setConfig(client, { system: true });

/**
 * Run a single parameterised query in system context. Only for code paths
 * that are legitimately cross-issuer (webhook lookup, admin, cron).
 *
 * @param {string} text
 * @param {Array} [params]
 */
const queryAsSystem = (text, params) => inTransaction(setSystemContext, text, params);

module.exports = { pool, query, getClient, applyContext, setIssuerContext, queryAsIssuer, setSystemContext, queryAsSystem };
