/**
 * Development database reset — drops and recreates the public schema,
 * then re-runs all migrations from scratch.
 *
 * Usage:
 *   npm run db:reset
 *
 * NEVER runs in production.
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
    console.log('Dropping schemas...');
    await client.query('DROP SCHEMA IF EXISTS sandbox CASCADE');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    console.log('Schemas recreated.');
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
