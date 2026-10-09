require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../src/config');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  ssl: config.db.ssl,
});

const LOCK_TIMEOUT = '10s';
const LOCK_NOT_AVAILABLE = '55P03';

async function migrate() {
  const client = await pool.connect();
  try {
    // Pin the search path so the migrations bookkeeping table is always
    // created in and queried from the public schema, regardless of how the
    // connecting role's default search_path is configured (e.g. after a
    // DROP/CREATE of the public schema in PostgreSQL 15+).
    await client.query('SET search_path TO public');

    // RLS is fail-closed: without system context a data migration on an
    // RLS table would silently touch zero rows. Session-level on purpose —
    // some migration files issue their own COMMIT.
    await client.query("SET app.rls_system = 'on'");

    // Fail fast instead of hanging startup when another session (an open SQL
    // client, a running backup) holds a lock a migration needs. Only bounds
    // time spent *waiting* for a lock, not how long a migration may run.
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows: applied } = await client.query('SELECT filename FROM migrations ORDER BY id');
    const appliedSet = new Set(applied.map((r) => r.filename));

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  skip: ${file} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === LOCK_NOT_AVAILABLE) {
          throw new Error(
            `Migration ${file} could not get a table lock within ${LOCK_TIMEOUT} - another database session ` +
            'is holding it (commonly a SQL client left connected with an open transaction, or a running backup). ' +
            'Nothing was applied. Close that session and the next start will retry.'
          );
        }
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    console.log('All migrations applied.');
  } finally {
    client.release();
    await pool.end();
  }
}

// Run directly via `npm run migrate`
if (require.main === module) {
  migrate().catch((err) => {
    console.error('Migration error:', err.message);
    process.exit(1);
  });
}

module.exports = migrate;
