const db = require('../config/database');

async function findByKeyHash(keyHash) {
  const { rows } = await db.query(
    `SELECT ak.id AS key_id, ak.tenant_id, ak.label, ak.environment AS key_environment,
            t.subscription_tier AS tenant_subscription_tier,
            t.status            AS tenant_status,
            t.email             AS tenant_email,
            tq.document_count   AS tenant_document_count,
            tq.document_quota   AS tenant_document_quota,
            t.sandbox           AS tenant_sandbox,
            t.agreement_accepted_at AS tenant_agreement_accepted_at,
            t.agreement_version     AS tenant_agreement_version
     FROM api_keys ak
     JOIN tenants t ON t.id = ak.tenant_id
     LEFT JOIN tenant_quotas tq ON tq.tenant_id = t.id AND tq.is_current = true
     WHERE ak.key_hash = $1
       AND ak.active = true`,
    [keyHash]
  );
  return rows[0] || null;
}

async function create({ tenantId, keyHash, label, environment }) {
  const { rows } = await db.query(
    `INSERT INTO api_keys (tenant_id, key_hash, label, environment)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [tenantId, keyHash, label || null, environment]
  );
  return rows[0];
}

async function findActiveByTenantId(tenantId) {
  const { rows } = await db.query(
    `SELECT id, label, environment, active, created_at, revoked_at
     FROM api_keys
     WHERE tenant_id = $1 AND active = true
     ORDER BY created_at DESC`,
    [tenantId]
  );
  return rows;
}

async function findByIdAndTenantId(id, tenantId) {
  const { rows } = await db.query(
    `SELECT * FROM api_keys WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function revoke(id) {
  const { rows } = await db.query(
    `UPDATE api_keys SET active = false, revoked_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function revokeAllByTenantIdAndEnvironment(tenantId, environment) {
  await db.query(
    `UPDATE api_keys SET active = false, revoked_at = NOW()
     WHERE tenant_id = $1 AND environment = $2 AND active = true`,
    [tenantId, environment]
  );
}

module.exports = {
  findByKeyHash,
  create,
  findActiveByTenantId,
  findByIdAndTenantId,
  revoke,
  revokeAllByTenantIdAndEnvironment,
};
