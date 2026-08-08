const db = require('../config/database');

async function findByKeyHash(keyHash) {
  const { rows } = await db.query(
    `SELECT ak.id AS key_id, ak.tenant_id, ak.label, ak.environment AS key_environment,
            ak.scopes AS key_scopes,
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

async function create({ tenantId, keyHash, label, environment, scopes }) {
  const { rows } = await db.query(
    `INSERT INTO api_keys (tenant_id, key_hash, label, environment, scopes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [tenantId, keyHash, label || null, environment, scopes]
  );
  return rows[0];
}

async function findActiveByTenantId(tenantId) {
  const { rows } = await db.query(
    `SELECT ak.id, ak.label, ak.environment, ak.scopes, ak.active, ak.created_at, ak.revoked_at,
            COALESCE(u.request_count, 0)::bigint AS request_count,
            u.last_used_at
     FROM api_keys ak
     LEFT JOIN LATERAL (
       SELECT SUM(request_count) AS request_count, MAX(last_used_at) AS last_used_at
       FROM api_key_daily_usage
       WHERE api_key_id = ak.id
     ) u ON true
     WHERE ak.tenant_id = $1 AND ak.active = true
     ORDER BY ak.created_at DESC`,
    [tenantId]
  );
  return rows;
}

// Fire-and-forget from authenticate.js on every successful lookup — one
// upsert is the only write per request. Also the single source of truth for
// findActiveByTenantId's lifetime totals and findDailyUsage's chart data, so
// there's no separate counter that could drift out of sync with this table.
async function touchUsage(id) {
  await db.query(
    `INSERT INTO api_key_daily_usage (api_key_id, usage_date, request_count, last_used_at)
     VALUES ($1, CURRENT_DATE, 1, NOW())
     ON CONFLICT (api_key_id, usage_date)
     DO UPDATE SET request_count = api_key_daily_usage.request_count + 1, last_used_at = NOW()`,
    [id]
  );
}

// Zero-filled daily series for the last `days` days (inclusive of today) —
// cast to text server-side to sidestep DATE -> JS Date timezone ambiguity.
async function findDailyUsage(apiKeyId, days) {
  const { rows } = await db.query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS usage_date,
            COALESCE(u.request_count, 0)::bigint AS request_count
     FROM generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, interval '1 day') AS d
     LEFT JOIN api_key_daily_usage u ON u.api_key_id = $1 AND u.usage_date = d::date
     ORDER BY d`,
    [apiKeyId, days]
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
  touchUsage,
  findDailyUsage,
};
