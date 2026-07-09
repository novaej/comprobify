const db = require('../config/database');
const { getClient } = db;

// Seeds the tenant's first quota period. Accepts an optional external
// transaction client so tenant creation can insert the tenants row and this
// row atomically — see registration.service.js / admin.service.js.
async function create({ tenantId, periodStart, periodEnd, documentQuota }, client = null) {
  const conn = client || db;
  const { rows } = await conn.query(
    `INSERT INTO tenant_quotas (tenant_id, period_start, period_end, document_quota)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [tenantId, periodStart, periodEnd, documentQuota]
  );
  return rows[0];
}

async function findCurrentByTenantId(tenantId) {
  const { rows } = await db.query(
    'SELECT * FROM tenant_quotas WHERE tenant_id = $1 AND is_current = true',
    [tenantId]
  );
  return rows[0] || null;
}

async function findCurrentByTenantIds(tenantIds) {
  if (tenantIds.length === 0) return [];
  const { rows } = await db.query(
    'SELECT * FROM tenant_quotas WHERE tenant_id = ANY($1) AND is_current = true',
    [tenantIds]
  );
  return rows;
}

async function updateCap(tenantId, documentQuota) {
  const { rows } = await db.query(
    `UPDATE tenant_quotas SET document_quota = $1
     WHERE tenant_id = $2 AND is_current = true
     RETURNING *`,
    [documentQuota, tenantId]
  );
  return rows[0] || null;
}

// Atomic quota gate — must run inside the caller's transaction (the same
// client used for the rest of document creation), so a rollback anywhere
// else in that transaction also un-consumes the quota. Returns whether the
// increment happened (false = at cap already, or no current row at all).
async function incrementIfWithinCap(client, tenantId) {
  const { rows } = await client.query(
    `UPDATE tenant_quotas SET document_count = document_count + 1
     WHERE tenant_id = $1 AND is_current = true AND document_count < document_quota
     RETURNING id`,
    [tenantId]
  );
  return rows.length > 0;
}

// Every current period whose period_end has passed — what the daily reset
// job iterates over. Joins the tenant's live subscription_tier so the job
// knows the cap to apply for the new period (a tier change since the period
// started must be reflected in the rolled-over cap).
async function findDueForReset() {
  const { rows } = await db.query(
    `SELECT tq.*, t.subscription_tier
     FROM tenant_quotas tq
     JOIN tenants t ON t.id = tq.tenant_id
     WHERE tq.is_current = true AND tq.period_end <= NOW()`
  );
  return rows;
}

// Atomically closes the current period and opens the next one, mirroring
// agreement.model.js's activate() transaction shape.
async function rollover(tenantId, newPeriodStart, newPeriodEnd, documentQuota) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE tenant_quotas SET is_current = false WHERE tenant_id = $1 AND is_current = true',
      [tenantId]
    );
    const { rows } = await client.query(
      `INSERT INTO tenant_quotas (tenant_id, period_start, period_end, document_quota, document_count, is_current)
       VALUES ($1, $2, $3, $4, 0, true)
       RETURNING *`,
      [tenantId, newPeriodStart, newPeriodEnd, documentQuota]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  create,
  findCurrentByTenantId,
  findCurrentByTenantIds,
  updateCap,
  incrementIfWithinCap,
  findDueForReset,
  rollover,
};
