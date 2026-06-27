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

async function create({ tenantId, ruc, businessName, tradeName, mainAddress, branchCode, issuePointCode, emissionType, requiredAccounting, specialTaxpayer, branchAddress, encryptedPrivateKey, certificatePem, certFingerprint, certExpiry, logo = null }) {
  const { rows } = await db.query(
    `INSERT INTO issuers (tenant_id, ruc, business_name, trade_name, main_address, branch_code, issue_point_code, emission_type, required_accounting, special_taxpayer, branch_address, encrypted_private_key, certificate_pem, cert_fingerprint, cert_expiry, logo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`,
    [tenantId, ruc, businessName, tradeName, mainAddress, branchCode, issuePointCode, emissionType, requiredAccounting, specialTaxpayer, branchAddress, encryptedPrivateKey, certificatePem, certFingerprint, certExpiry, logo]
  );
  return rows[0];
}

async function updateLogo(issuerId, tenantId, logoBuffer) {
  const { rows } = await db.query(
    'UPDATE issuers SET logo = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 AND active = true RETURNING id',
    [logoBuffer, issuerId, tenantId]
  );
  return rows[0] || null;
}

async function updateCertificate(issuerId, tenantId, { encryptedPrivateKey, certificatePem, certFingerprint, certExpiry }) {
  const { rows } = await db.query(
    `UPDATE issuers
     SET encrypted_private_key = $1, certificate_pem = $2, cert_fingerprint = $3, cert_expiry = $4, updated_at = NOW()
     WHERE id = $5 AND tenant_id = $6 AND active = true
     RETURNING id, cert_fingerprint, cert_expiry`,
    [encryptedPrivateKey, certificatePem, certFingerprint, certExpiry, issuerId, tenantId]
  );
  return rows[0] || null;
}

async function findAll() {
  const { rows } = await db.query(
    `SELECT id, tenant_id, ruc, business_name, trade_name, branch_code, issue_point_code, cert_expiry, cert_fingerprint, active
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

async function findAllByTenantId(tenantId) {
  const { rows } = await db.query(
    `SELECT id, ruc, business_name, trade_name, branch_code, issue_point_code,
            branch_address, cert_fingerprint, cert_expiry
     FROM issuers WHERE tenant_id = $1 AND active = true ORDER BY id`,
    [tenantId]
  );
  return rows;
}

async function update(issuerId, tenantId, { tradeName, branchAddress }) {
  const { rows } = await db.query(
    `UPDATE issuers
     SET trade_name = COALESCE($1, trade_name),
         branch_address = COALESCE($2, branch_address),
         updated_at = NOW()
     WHERE id = $3 AND tenant_id = $4 AND active = true
     RETURNING *`,
    [tradeName ?? null, branchAddress ?? null, issuerId, tenantId]
  );
  return rows[0] || null;
}

async function deactivate(issuerId, tenantId) {
  const { rows } = await db.query(
    'UPDATE issuers SET active = false, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 AND active = true RETURNING id',
    [issuerId, tenantId]
  );
  return rows[0] || null;
}

async function countActiveByTenantId(tenantId) {
  const { rows } = await db.query(
    'SELECT COUNT(*) AS count FROM issuers WHERE tenant_id = $1 AND active = true',
    [tenantId]
  );
  return parseInt(rows[0].count, 10);
}

async function findByIdAny(id) {
  const { rows } = await db.query('SELECT * FROM issuers WHERE id = $1', [id]);
  return rows[0] || null;
}

async function activate(issuerId, tenantId) {
  const { rows } = await db.query(
    'UPDATE issuers SET active = true, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 AND active = false RETURNING id',
    [issuerId, tenantId]
  );
  return rows[0] || null;
}

module.exports = { findById, findByRuc, findFirst, findByTenantId, findAllByTenantId, create, findAll, updateLogo, updateCertificate, update, deactivate, countActiveByTenantId, findByIdAny, activate };
