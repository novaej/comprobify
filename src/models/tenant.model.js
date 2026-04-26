const db = require('../config/database');

async function create({ email, subscriptionTier = 'FREE', status = 'PENDING_VERIFICATION', invoiceQuota = 100, verificationToken = null, verificationTokenExpiresAt = null }) {
  const { rows } = await db.query(
    `INSERT INTO tenants (email, subscription_tier, status, invoice_quota, verification_token, verification_token_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [email, subscriptionTier, status, invoiceQuota, verificationToken, verificationTokenExpiresAt]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM tenants WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findByEmail(email) {
  const { rows } = await db.query('SELECT * FROM tenants WHERE email = $1', [email]);
  return rows[0] || null;
}

async function findByVerificationToken(token) {
  const { rows } = await db.query(
    `SELECT * FROM tenants WHERE verification_token = $1 AND verification_token_expires_at > NOW()`,
    [token]
  );
  return rows[0] || null;
}

async function findAll() {
  const { rows } = await db.query('SELECT * FROM tenants ORDER BY id');
  return rows;
}

async function activate(id) {
  const { rows } = await db.query(
    `UPDATE tenants
     SET status = 'ACTIVE', verification_token = NULL, verification_token_expires_at = NULL, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function updateTier(id, tier, invoiceQuota) {
  const { rows } = await db.query(
    `UPDATE tenants SET subscription_tier = $1, invoice_quota = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
    [tier, invoiceQuota, id]
  );
  return rows[0] || null;
}

async function updateStatus(id, status) {
  const { rows } = await db.query(
    `UPDATE tenants SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return rows[0] || null;
}

async function countIssuersByTenantId(tenantId) {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS count FROM issuers WHERE tenant_id = $1 AND active = true`,
    [tenantId]
  );
  return parseInt(rows[0].count, 10);
}

module.exports = { create, findById, findByEmail, findByVerificationToken, findAll, activate, updateTier, updateStatus, countIssuersByTenantId };
