const db = require('../config/database');

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM issuers WHERE id = $1 AND active = true', [id]);
  return rows[0] || null;
}

async function findByRuc(ruc) {
  const { rows } = await db.query('SELECT * FROM issuers WHERE ruc = $1 AND active = true', [ruc]);
  return rows[0] || null;
}

async function findFirst() {
  const { rows } = await db.query('SELECT * FROM issuers WHERE active = true ORDER BY id LIMIT 1');
  return rows[0] || null;
}

async function create({ tenantId, ruc, businessName, tradeName, mainAddress, branchCode, issuePointCode, environment, emissionType, requiredAccounting, specialTaxpayer, branchAddress, encryptedPrivateKey, certificatePem, certFingerprint, certExpiry, sandbox }) {
  const { rows } = await db.query(
    `INSERT INTO issuers (tenant_id, ruc, business_name, trade_name, main_address, branch_code, issue_point_code, environment, emission_type, required_accounting, special_taxpayer, branch_address, encrypted_private_key, certificate_pem, cert_fingerprint, cert_expiry, sandbox)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [tenantId, ruc, businessName, tradeName, mainAddress, branchCode, issuePointCode, environment, emissionType, requiredAccounting, specialTaxpayer, branchAddress, encryptedPrivateKey, certificatePem, certFingerprint, certExpiry, sandbox !== false]
  );
  return rows[0];
}

async function findAll() {
  const { rows } = await db.query(
    `SELECT id, tenant_id, ruc, business_name, trade_name, environment, branch_code, issue_point_code, cert_expiry, cert_fingerprint, active, sandbox
     FROM issuers
     ORDER BY id`
  );
  return rows;
}

async function findByTenantId(tenantId) {
  const { rows } = await db.query(
    'SELECT * FROM issuers WHERE tenant_id = $1 AND active = true ORDER BY id LIMIT 1',
    [tenantId]
  );
  return rows[0] || null;
}

async function promote(id) {
  const { rows } = await db.query(
    `UPDATE issuers SET sandbox = false WHERE id = $1 AND active = true RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

module.exports = { findById, findByRuc, findFirst, findByTenantId, create, findAll, promote };
