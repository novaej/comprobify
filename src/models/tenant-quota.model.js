const db = require('../config/database');
const { getClient } = db;

// Seeds the tenant's first quota period. Accepts an optional external
// transaction client so tenant creation can insert the tenants row and this
// row atomically — see registration.service.js / admin.service.js.
async function create({ tenantId, periodStart, periodEnd, documentQuota, billingInterval = 'MONTHLY' }, client = null) {
  const conn = client || db;
  const { rows } = await conn.query(
    `INSERT INTO tenant_quotas (tenant_id, period_start, period_end, document_quota, billing_interval)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [tenantId, periodStart, periodEnd, documentQuota, billingInterval]
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

// Updates the current period's cap, billing_interval, and period_end
// together. period_end is passed in already computed (by
// tenant-quota.service.js's setCap(), via the shared addMonths() helper),
// never derived here with raw SQL date arithmetic — Postgres's own
// `date + interval 'N months'` overflows month-end exactly like a bare JS
// Date.setMonth() does (Jan 31 + 1 month silently becomes Mar 3, not
// "Feb 29/28"), the same class of bug CLAUDE.md Common Mistake #26 already
// covers for subscription periods. Reusing addMonths() here instead of
// reimplementing the clamp in SQL keeps one single source of truth for it.
// Never touches document_count: already-consumed documents this cycle still
// count against whatever the new cap is.
async function updateCapAndInterval(tenantId, documentQuota, billingInterval, periodEnd) {
  const { rows } = await db.query(
    `UPDATE tenant_quotas
     SET document_quota = $1,
         billing_interval = $2,
         period_end = $3
     WHERE tenant_id = $4 AND is_current = true
     RETURNING *`,
    [documentQuota, billingInterval, periodEnd, tenantId]
  );
  return rows[0] || null;
}

// Atomic quota gate — must run inside the caller's transaction (the same
// client used for the rest of document creation), so a rollback anywhere
// else in that transaction also un-consumes the quota. Returns whether the
// increment happened (false = at cap already, or no current row at all). A
// NULL document_quota (ENTERPRISE's genuine-unlimited tier) never blocks —
// document_count still increments for visibility/reporting.
async function incrementIfWithinCap(client, tenantId) {
  const { rows } = await client.query(
    `UPDATE tenant_quotas SET document_count = document_count + 1
     WHERE tenant_id = $1 AND is_current = true
       AND (document_quota IS NULL OR document_count < document_quota)
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
// agreement.model.js's activate() transaction shape. Carries billing_interval
// forward onto the new row so a subsequent reset (or setCap call) can keep
// reading it straight off tenant_quotas without re-deriving it from
// subscriptions.
async function rollover(tenantId, newPeriodStart, newPeriodEnd, documentQuota, billingInterval = 'MONTHLY') {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE tenant_quotas SET is_current = false WHERE tenant_id = $1 AND is_current = true',
      [tenantId]
    );
    const { rows } = await client.query(
      `INSERT INTO tenant_quotas (tenant_id, period_start, period_end, document_quota, billing_interval, document_count, is_current)
       VALUES ($1, $2, $3, $4, $5, 0, true)
       RETURNING *`,
      [tenantId, newPeriodStart, newPeriodEnd, documentQuota, billingInterval]
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
  updateCapAndInterval,
  incrementIfWithinCap,
  findDueForReset,
  rollover,
};
