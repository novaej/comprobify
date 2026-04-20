const { Pool } = require('pg');
const config = require('./index');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  ssl: config.db.ssl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

const query = (text, params) => pool.query(text, params);

const getClient = () => pool.connect();

/**
 * Set the transaction-local issuer context on an existing client.
 * Must be called after BEGIN so the setting is automatically rolled back
 * if the transaction aborts.
 *
 * @param {import('pg').PoolClient} client
 * @param {number|string} issuerId
 */
const setIssuerContext = (client, issuerId) =>
  client.query("SELECT set_config('app.current_issuer_id', $1, true)", [String(issuerId)]);

/**
 * Run a single parameterised query with the RLS issuer context set.
 * Opens a mini-transaction, sets the context, runs the query, and commits.
 * Use this for non-transactional model queries in authenticated code paths.
 *
 * @param {number|string} issuerId
 * @param {string} text
 * @param {Array} [params]
 */
const queryAsIssuer = async (issuerId, text, params) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_issuer_id', $1, true)", [String(issuerId)]);
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, getClient, setIssuerContext, queryAsIssuer };
