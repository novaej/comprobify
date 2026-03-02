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

async function create({ ruc, businessName, tradeName, mainAddress, branchCode, issuePointCode, environment, emissionType, requiredAccounting, specialTaxpayer, branchAddress, encryptedPrivateKey, certificatePem, certFingerprint, certExpiry }) {
  const { rows } = await db.query(
    `INSERT INTO issuers (ruc, business_name, trade_name, main_address, branch_code, issue_point_code, environment, emission_type, required_accounting, special_taxpayer, branch_address, encrypted_private_key, certificate_pem, cert_fingerprint, cert_expiry)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [ruc, businessName, tradeName, mainAddress, branchCode, issuePointCode, environment, emissionType, requiredAccounting, specialTaxpayer, branchAddress, encryptedPrivateKey, certificatePem, certFingerprint, certExpiry]
  );
  return rows[0];
}

async function findAll() {
  const { rows } = await db.query(
    `SELECT id, ruc, business_name, trade_name, environment, branch_code, issue_point_code, cert_expiry, cert_fingerprint, active
     FROM issuers
     ORDER BY id`
  );
  return rows;
}

module.exports = { findById, findByRuc, findFirst, create, findAll };
