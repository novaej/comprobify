/**
 * Development database reset — drops all application tables and schemas,
 * then re-runs all migrations from scratch.
 *
 * Usage:
 *   npm run db:reset
 *
 * NEVER runs in production.
 *
 * Note: DROP SCHEMA public CASCADE requires schema ownership (PostgreSQL 15+
 * assigns public to pg_database_owner, not the app user). We drop all tables
 * inside public instead — the app user owns the tables it created.
 */

require('dotenv').config();

const { Pool } = require('pg');
const config = require('../src/config');
const migrate = require('./migrate');

if (config.appEnv === 'production') {
  console.error('db:reset must not run in production (APP_ENV=production).');
  process.exit(1);
}

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  ssl: config.db.ssl,
});

async function reset() {
  const client = await pool.connect();
  try {
    console.log('Dropping schemas and tables...');

    // Drop the sandbox schema entirely (app user owns it — created in migration 033)
    await client.query('DROP SCHEMA IF EXISTS sandbox CASCADE');

    // Drop all tables in the public schema. We own the tables (created via migrations)
    // but not the schema itself, so we cannot DROP SCHEMA public CASCADE.
    // Dropping tables in CASCADE order removes dependent objects (indexes, triggers,
    // sequences, constraints, RLS policies) automatically.
    await client.query(`
      DO $$ DECLARE r RECORD; BEGIN
        FOR r IN (
          SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        ) LOOP
          EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$
    `);

    console.log('Schemas and tables dropped.');
  } finally {
    client.release();
    await pool.end();
  }

  console.log('Running migrations...');
  await migrate();
}

reset().catch((err) => {
  console.error('Reset failed:', err.message);
  process.exit(1);
});
