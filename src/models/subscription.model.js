const db = require('../config/database');

const MUTABLE_EXTRA_COLUMNS = new Set([
  'initial_invoice_document_id',
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

async function findByInitialInvoiceDocumentId(documentId) {
  const { rows } = await db.query(
    'SELECT * FROM subscriptions WHERE initial_invoice_document_id = $1',
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

// Records a pending change (tier and/or billing interval) without touching
// the active tier/interval/quota — applied later, at current_period_end, by
// applyScheduledTierChanges(). pendingBillingInterval is null for a plain
// free tier downgrade (interval unchanged); set when a paid interval switch
// (see applyTierChangeIfLinked) is being scheduled for period-end instead of
// applied immediately.
async function scheduleDowngrade(id, pendingTier, pendingBillingInterval = null) {
  const { rows } = await db.query(
    'UPDATE subscriptions SET pending_tier = $2, pending_billing_interval = $3 WHERE id = $1 RETURNING *',
    [id, pendingTier, pendingBillingInterval]
  );
  return rows[0] || null;
}

// Flips the active tier (and optionally billing interval) immediately and
// clears any scheduled pending_tier/pending_billing_interval. Used both by
// the upgrade-on-invoice-authorization path and by the
// downgrade-at-period-end job — in both cases the change is final.
// billingInterval is only passed when it needs to change; COALESCE leaves it
// untouched otherwise (e.g. a tier-only upgrade never changes interval).
async function applyTierChange(id, tier, billingInterval = null) {
  const { rows } = await db.query(
    `UPDATE subscriptions
     SET tier = $2, billing_interval = COALESCE($3, billing_interval),
         pending_tier = NULL, pending_billing_interval = NULL
     WHERE id = $1
     RETURNING *`,
    [id, tier, billingInterval]
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

// ACTIVE subscriptions whose current_period_end falls within reminderDays from
// now, with no scheduled downgrade (that period transition is handled for free
// by findDuePendingDowngrades/applyScheduledTierChanges instead) and no renewal
// payment already open for this period (avoids re-creating one on every job run).
// "already open" is period_start IS NULL, not invoice_document_id IS NULL — a
// sandbox-linked renewal invoice never sets invoice_document_id (see
// linkSandboxDocument), so that check would never stop matching a sandbox
// renewal that already applied, permanently suppressing the next reminder.
// Mirrors the same fix in payment.model.js's findPendingRenewalBySubscriptionId.
async function findDueForRenewalReminder(reminderDays) {
  const { rows } = await db.query(
    `SELECT * FROM subscriptions s
     WHERE s.status = 'ACTIVE'
       AND s.pending_tier IS NULL
       AND s.current_period_end > NOW()
       AND s.current_period_end <= NOW() + (INTERVAL '1 day' * $1)
       AND NOT EXISTS (
         SELECT 1 FROM payments p
         WHERE p.subscription_id = s.id AND p.purpose = 'RENEWAL'
           AND p.period_start IS NULL
           AND p.status IN ('PENDING', 'REPORTED', 'VERIFIED')
       )`,
    [reminderDays]
  );
  return rows;
}

// ACTIVE subscriptions whose current_period_end passed more than graceDays ago
// with no renewal ever completing — these get downgraded to FREE. A renewal that
// completed in time always re-stamps current_period_end into the future (see
// applyRenewalIfLinked), so a still-ACTIVE row this far past its old period_end
// genuinely never renewed.
async function findExpiredPastGrace(graceDays) {
  const { rows } = await db.query(
    `SELECT * FROM subscriptions
     WHERE status = 'ACTIVE'
       AND current_period_end <= NOW() - (INTERVAL '1 day' * $1)`,
    [graceDays]
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
  findByInitialInvoiceDocumentId,
  findByTenantId,
  findActiveByTenantId,
  scheduleDowngrade,
  applyTierChange,
  findDuePendingDowngrades,
  findDueForRenewalReminder,
  findExpiredPastGrace,
  updateStatus,
};
