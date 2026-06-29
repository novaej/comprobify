const db = require('../config/database');

const MUTABLE_EXTRA_COLUMNS = new Set([
  'invoice_document_id',
  'current_period_start',
  'current_period_end',
  'canceled_at',
]);

async function create({ tenantId, tier, billingInterval = 'MONTHLY' }) {
  const { rows } = await db.query(
    `INSERT INTO subscriptions (tenant_id, tier, billing_interval)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [tenantId, tier, billingInterval]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM subscriptions WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findActiveOrPendingByTenantId(tenantId) {
  const { rows } = await db.query(
    `SELECT * FROM subscriptions
     WHERE tenant_id = $1
       AND status NOT IN ('CANCELLED', 'EXPIRED')
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId]
  );
  return rows[0] || null;
}

async function findByInvoiceDocumentId(documentId) {
  const { rows } = await db.query(
    'SELECT * FROM subscriptions WHERE invoice_document_id = $1',
    [documentId]
  );
  return rows[0] || null;
}

async function findByTenantId(tenantId) {
  const { rows } = await db.query(
    'SELECT * FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId]
  );
  return rows;
}

async function findActiveByTenantId(tenantId) {
  const { rows } = await db.query(
    `SELECT * FROM subscriptions WHERE tenant_id = $1 AND status = 'ACTIVE'`,
    [tenantId]
  );
  return rows[0] || null;
}

// Records a downgrade request without touching the active tier/quota — applied
// later, at current_period_end, by applyScheduledTierChanges().
async function scheduleDowngrade(id, pendingTier) {
  const { rows } = await db.query(
    'UPDATE subscriptions SET pending_tier = $2 WHERE id = $1 RETURNING *',
    [id, pendingTier]
  );
  return rows[0] || null;
}

// Flips the active tier immediately and clears any scheduled pending_tier.
// Used both by the upgrade-on-invoice-authorization path and by the
// downgrade-at-period-end job — in both cases the tier change is final.
async function applyTierChange(id, tier) {
  const { rows } = await db.query(
    'UPDATE subscriptions SET tier = $2, pending_tier = NULL WHERE id = $1 RETURNING *',
    [id, tier]
  );
  return rows[0] || null;
}

async function findDuePendingDowngrades() {
  const { rows } = await db.query(
    `SELECT * FROM subscriptions
     WHERE status = 'ACTIVE' AND pending_tier IS NOT NULL AND current_period_end <= NOW()`
  );
  return rows;
}

async function updateStatus(id, status, extraFields = {}) {
  for (const col of Object.keys(extraFields)) {
    if (!MUTABLE_EXTRA_COLUMNS.has(col)) {
      throw new Error(`subscription.updateStatus: unknown column "${col}"`);
    }
  }

  const sets = ['status = $2'];
  const params = [id, status];
  let idx = 3;
  for (const [col, val] of Object.entries(extraFields)) {
    sets.push(`${col} = $${idx}`);
    params.push(val);
    idx++;
  }

  const { rows } = await db.query(
    `UPDATE subscriptions SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] || null;
}

module.exports = {
  create,
  findById,
  findActiveOrPendingByTenantId,
  findByInvoiceDocumentId,
  findByTenantId,
  findActiveByTenantId,
  scheduleDowngrade,
  applyTierChange,
  findDuePendingDowngrades,
  updateStatus,
};
