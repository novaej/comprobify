const db = require('../config/database');

async function findByKeyHash(keyHash) {
  const { rows } = await db.query(
    `SELECT ak.id AS key_id, ak.issuer_id, ak.label, ak.environment AS key_environment,
            i.*,
            t.subscription_tier AS tenant_subscription_tier,
            t.status            AS tenant_status,
            t.email             AS tenant_email,
            t.invoice_count     AS tenant_invoice_count,
            t.invoice_quota     AS tenant_invoice_quota
     FROM api_keys ak
     JOIN issuers i  ON i.id = ak.issuer_id
     JOIN tenants t  ON t.id = i.tenant_id
     WHERE ak.key_hash = $1
       AND ak.active = true
       AND i.active = true`,
    [keyHash]
  );
  return rows[0] || null;
}

async function create({ issuerId, keyHash, label, environment }) {
  const { rows } = await db.query(
    `INSERT INTO api_keys (issuer_id, key_hash, label, environment)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [issuerId, keyHash, label || null, environment]
  );
  return rows[0];
}

async function revoke(id) {
  const { rows } = await db.query(
    `UPDATE api_keys SET active = false, revoked_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function revokeAllByIssuerId(issuerId) {
  await db.query(
    `UPDATE api_keys SET active = false, revoked_at = NOW()
     WHERE issuer_id = $1 AND active = true`,
    [issuerId]
  );
}

async function revokeAllByIssuerIdAndEnvironment(issuerId, environment) {
  await db.query(
    `UPDATE api_keys SET active = false, revoked_at = NOW()
     WHERE issuer_id = $1 AND environment = $2 AND active = true`,
    [issuerId, environment]
  );
}

module.exports = { findByKeyHash, create, revoke, revokeAllByIssuerId, revokeAllByIssuerIdAndEnvironment };
