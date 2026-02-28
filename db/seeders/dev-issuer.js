/**
 * Development seeder — inserts a test issuer.
 * Safe to run multiple times (upserts on RUC).
 *
 * Usage:
 *   npm run seed:dev
 *
 * Requires:
 *   - DB running and migrations applied (npm run migrate)
 *   - ENCRYPTION_KEY set in .env
 *   - CERT_PASSWORD env var (P12 plaintext password)
 *
 * Issuer data is read from .env (DEV_ISSUER_* variables).
 * See .example.env for the full list of configurable fields.
 */

require('dotenv').config();

const { Pool } = require('pg');
const config = require('../../src/config');
const cryptoService = require('../../src/services/crypto.service');

if (process.env.NODE_ENV === 'production') {
  console.error('Seeder must not run in production.');
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

const DEV_ISSUER = {
  ruc:                process.env.DEV_ISSUER_RUC            || '1700000000001',
  business_name:      process.env.DEV_ISSUER_BUSINESS_NAME  || 'DEV COMPANY S.A.',
  trade_name:         process.env.DEV_ISSUER_TRADE_NAME     || 'DEV CO',
  main_address:       process.env.DEV_ISSUER_ADDRESS        || 'AV. AMAZONAS N39-123, QUITO',
  branch_code:        process.env.DEV_ISSUER_BRANCH_CODE    || '001',
  issue_point_code:   process.env.DEV_ISSUER_ISSUE_POINT    || '001',
  environment:        process.env.DEV_ISSUER_ENVIRONMENT    || '1',   // 1 = SRI test, 2 = production
  emission_type:      '1',
  required_accounting: process.env.DEV_ISSUER_ACCOUNTING    || 'NO',
  branch_address:     process.env.DEV_ISSUER_ADDRESS        || 'AV. AMAZONAS N39-123, QUITO',
  cert_path:          process.env.DEV_ISSUER_CERT_PATH      || 'cert/token.p12',
};

async function seed() {
  const certPassword = process.env.CERT_PASSWORD;
  if (!certPassword) {
    console.error('Set CERT_PASSWORD env var to your P12 plaintext password.');
    console.error('Example: CERT_PASSWORD=mypassword npm run seed:dev');
    process.exit(1);
  }

  const certPasswordEnc = cryptoService.encrypt(certPassword);

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `INSERT INTO issuers
        (ruc, business_name, trade_name, main_address,
         branch_code, issue_point_code, environment, emission_type,
         required_accounting, branch_address, cert_path, cert_password_enc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (ruc) DO UPDATE SET
         business_name      = EXCLUDED.business_name,
         trade_name         = EXCLUDED.trade_name,
         cert_path          = EXCLUDED.cert_path,
         cert_password_enc  = EXCLUDED.cert_password_enc,
         updated_at         = NOW()
       RETURNING id, ruc, business_name, environment`,
      [
        DEV_ISSUER.ruc,
        DEV_ISSUER.business_name,
        DEV_ISSUER.trade_name,
        DEV_ISSUER.main_address,
        DEV_ISSUER.branch_code,
        DEV_ISSUER.issue_point_code,
        DEV_ISSUER.environment,
        DEV_ISSUER.emission_type,
        DEV_ISSUER.required_accounting,
        DEV_ISSUER.branch_address,
        DEV_ISSUER.cert_path,
        certPasswordEnc,
      ]
    );

    const issuer = rows[0];
    console.log(`✓ Dev issuer seeded — id: ${issuer.id}, ruc: ${issuer.ruc}, env: ${issuer.environment}`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
