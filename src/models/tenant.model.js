const db = require('../config/database');
const TenantStatus = require('../constants/tenant-status');
const EmailStatus = require('../constants/email-status');

async function create({ email, subscriptionTier = 'FREE', status = TenantStatus.PENDING_VERIFICATION, documentQuota = 5, verificationToken = null, verificationTokenExpiresAt = null, verificationRedirectUrl = null, preferredLanguage = 'es', legalVersion = null, legalSnapshotHash = null }) {
  const { rows } = await db.query(
    `INSERT INTO tenants (email, subscription_tier, status, document_quota, verification_token, verification_token_expires_at, verification_redirect_url, preferred_language, legal_accepted_at, legal_version, legal_snapshot_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9::TEXT IS NULL THEN NULL ELSE NOW() END, $9, $10)
     RETURNING *`,
    [email, subscriptionTier, status, documentQuota, verificationToken, verificationTokenExpiresAt, verificationRedirectUrl, preferredLanguage, legalVersion, legalSnapshotHash]
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

/**
 * Return all non-suspended tenants. Used by the notification scheduler job to
 * run cert checks and webhook retries across every active tenant.
 */
async function findAllActive() {
  const { rows } = await db.query(
    `SELECT * FROM tenants WHERE status != $1 ORDER BY id`,
    [TenantStatus.SUSPENDED]
  );
  return rows;
}

async function activate(id) {
  const { rows } = await db.query(
    `UPDATE tenants
     SET status = $1, verification_token = NULL, verification_token_expires_at = NULL, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [TenantStatus.ACTIVE, id]
  );
  return rows[0] || null;
}

async function updateTier(id, tier, documentQuota) {
  const { rows } = await db.query(
    `UPDATE tenants SET subscription_tier = $1, document_quota = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
    [tier, documentQuota, id]
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

async function findByVerificationEmailMessageId(messageId) {
  const { rows } = await db.query(
    'SELECT * FROM tenants WHERE verification_email_message_id = $1',
    [messageId]
  );
  return rows[0] || null;
}

async function updateVerificationEmailStatus(id, status) {
  const { rows } = await db.query(
    `UPDATE tenants SET verification_email_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return rows[0] || null;
}

async function updateVerificationEmailSent(id, messageId) {
  const { rows } = await db.query(
    `UPDATE tenants SET verification_email_message_id = $1, verification_email_status = $2, verification_email_sent_at = NOW(), updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [messageId, EmailStatus.SENT, id]
  );
  return rows[0] || null;
}

async function updateVerificationToken(id, token, expiresAt) {
  const { rows } = await db.query(
    `UPDATE tenants SET verification_token = $1, verification_token_expires_at = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [token, expiresAt, id]
  );
  return rows[0] || null;
}

async function updateVerificationRedirectUrl(id, url) {
  const { rows } = await db.query(
    `UPDATE tenants SET verification_redirect_url = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [url, id]
  );
  return rows[0] || null;
}

async function updatePreferredLanguage(id, language) {
  const { rows } = await db.query(
    `UPDATE tenants SET preferred_language = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [language, id]
  );
  return rows[0] || null;
}

async function updateLegalAcceptance(id, version, snapshotHash) {
  const { rows } = await db.query(
    `UPDATE tenants SET legal_accepted_at = NOW(), legal_version = $1, legal_snapshot_hash = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
    [version, snapshotHash, id]
  );
  return rows[0] || null;
}

async function promote(id) {
  const { rows } = await db.query(
    `UPDATE tenants SET sandbox = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function countBranchesByTenantId(tenantId) {
  const { rows } = await db.query(
    `SELECT COUNT(DISTINCT branch_code) AS count FROM issuers WHERE tenant_id = $1 AND active = true`,
    [tenantId]
  );
  return parseInt(rows[0].count, 10);
}

async function countIssuePointsByBranch(tenantId, branchCode) {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS count FROM issuers WHERE tenant_id = $1 AND branch_code = $2 AND active = true`,
    [tenantId, branchCode]
  );
  return parseInt(rows[0].count, 10);
}

module.exports = { create, findById, findByEmail, findByVerificationToken, findAll, findAllActive, activate, promote, updateTier, updateStatus, updateVerificationToken, updateVerificationRedirectUrl, updatePreferredLanguage, updateLegalAcceptance, findByVerificationEmailMessageId, updateVerificationEmailStatus, updateVerificationEmailSent, countBranchesByTenantId, countIssuePointsByBranch };
