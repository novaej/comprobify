const db = require('../config/database');
const TenantStatus = require('../constants/tenant-status');
const EmailStatus = require('../constants/email-status');

// Accepts an optional external transaction client so the caller can wrap
// this INSERT and the tenant's first tenant_quotas row in one transaction —
// see registration.service.js / admin.service.js.
async function create({ email, subscriptionTier = 'FREE', status = TenantStatus.PENDING_VERIFICATION, verificationToken = null, verificationTokenExpiresAt = null, verificationRedirectUrl = null, preferredLanguage = 'es', legalVersion = null }, client = null) {
  const conn = client || db;
  const { rows } = await conn.query(
    `INSERT INTO tenants (email, subscription_tier, status, verification_token, verification_token_expires_at, verification_redirect_url, preferred_language, agreement_accepted_at, agreement_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8::TEXT IS NULL THEN NULL ELSE NOW() END, $8)
     RETURNING *`,
    [email, subscriptionTier, status, verificationToken, verificationTokenExpiresAt, verificationRedirectUrl, preferredLanguage, legalVersion]
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

async function updateTier(id, tier) {
  const { rows } = await db.query(
    `UPDATE tenants SET subscription_tier = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [tier, id]
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

async function updateAgreementAcceptance(id, version) {
  const { rows } = await db.query(
    `UPDATE tenants SET agreement_accepted_at = NOW(), agreement_version = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [version, id]
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

module.exports = { create, findById, findByEmail, findByVerificationToken, findAll, findAllActive, activate, promote, updateTier, updateStatus, updateVerificationToken, updateVerificationRedirectUrl, updatePreferredLanguage, updateAgreementAcceptance, findByVerificationEmailMessageId, updateVerificationEmailStatus, updateVerificationEmailSent, countBranchesByTenantId, countIssuePointsByBranch };
