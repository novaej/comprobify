const db = require('../config/database');

const MUTABLE_EXTRA_COLUMNS = new Set([
  'reported_at',
  'verified_at',
  'period_start',
  'period_end',
  'rejection_reason_code',
  'invoice_document_id',
  'invoiced_at',
  'applied_from',
]);

async function create({ subscriptionId, amount, ivaRate, ivaAmount, totalAmount, method = 'SPI_TRANSFER', purpose = 'INITIAL', targetTier = null, targetBillingInterval = null }) {
  const { rows } = await db.query(
    `INSERT INTO payments (subscription_id, amount, iva_rate, iva_amount, total_amount, method, purpose, target_tier, target_billing_interval)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [subscriptionId, amount, ivaRate, ivaAmount, totalAmount, method, purpose, targetTier, targetBillingInterval]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM payments WHERE id = $1', [id]);
  return rows[0] || null;
}

// Looks up a payment scoped to a specific tenant — joins subscriptions to verify
// ownership. Used by the tenant-facing proof download endpoint so a tenant can
// never access another tenant's proof by guessing an ID.
async function findByIdAndTenantId(id, tenantId) {
  const { rows } = await db.query(
    `SELECT p.* FROM payments p
     JOIN subscriptions s ON s.id = p.subscription_id
     WHERE p.id = $1 AND s.tenant_id = $2`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function findBySubscriptionId(subscriptionId) {
  const { rows } = await db.query(
    'SELECT * FROM payments WHERE subscription_id = $1 ORDER BY created_at DESC',
    [subscriptionId]
  );
  return rows;
}

// Cross-tenant queue of payments awaiting manual review — backs the admin
// payments list (GET /admin/payments). Joins subscriptions for tenant_id since
// payments don't carry it directly. Defaults to REPORTED (proof submitted,
// not yet decided) but accepts any status for the same endpoint to reuse.
async function findAllByStatus(status = 'REPORTED') {
  const { rows } = await db.query(
    `SELECT p.*, s.tenant_id, s.tier, s.billing_interval,
       COALESCE(
         (SELECT access_key FROM public.documents  WHERE id = p.invoice_document_id),
         (SELECT access_key FROM sandbox.documents WHERE id = p.invoice_document_id)
       ) AS invoice_access_key
     FROM payments p
     JOIN subscriptions s ON s.id = p.subscription_id
     WHERE p.status = $1
     ORDER BY p.reported_at ASC NULLS LAST, p.created_at ASC`,
    [status]
  );
  return rows;
}

// Finds an in-flight (not yet rejected/refunded) tier-change payment for a
// subscription that hasn't been applied yet — used to block a second
// concurrent tier-change request. period_start IS NULL is the
// applied/unapplied signal, not invoice_document_id: a sandbox document never
// gets invoice_document_id stored (see linkInvoice), but period_start is
// always stamped once the payment has been applied, in both environments.
//
// "Applied" no longer means "its invoice authorized" (ADR-027) — it means the
// payment was verified and applyVerifiedPayment ran. Which payment an invoice
// settles is a separate question, answered by
// findOldestUninvoicedBySubscriptionId.
async function findPendingTierChangeBySubscriptionId(subscriptionId) {
  const { rows } = await db.query(
    `SELECT * FROM payments
     WHERE subscription_id = $1 AND purpose = 'TIER_CHANGE'
       AND period_start IS NULL
       AND status IN ('PENDING', 'REPORTED', 'VERIFIED')
     ORDER BY created_at DESC
     LIMIT 1`,
    [subscriptionId]
  );
  return rows[0] || null;
}

// Mirrors findPendingTierChangeBySubscriptionId, but for a renewal payment —
// used to avoid creating a second renewal payment for the same upcoming period
// (processDueRenewals). See the comment above for why period_start, not
// invoice_document_id, is the applied/unapplied signal.
async function findPendingRenewalBySubscriptionId(subscriptionId) {
  const { rows } = await db.query(
    `SELECT * FROM payments
     WHERE subscription_id = $1 AND purpose = 'RENEWAL'
       AND period_start IS NULL
       AND status IN ('PENDING', 'REPORTED', 'VERIFIED')
     ORDER BY created_at DESC
     LIMIT 1`,
    [subscriptionId]
  );
  return rows[0] || null;
}

// Which payment an operator's freshly-issued invoice settles: the oldest
// verified-but-uninvoiced one for this subscription. Since ADR-027 a payment is
// already applied by the time its invoice is linked, so the old
// "period_start IS NULL means unapplied" signal no longer identifies it —
// invoiced_at does.
async function findOldestUninvoicedBySubscriptionId(subscriptionId) {
  const { rows } = await db.query(
    `SELECT * FROM payments
     WHERE subscription_id = $1 AND status = 'VERIFIED' AND invoiced_at IS NULL
     ORDER BY verified_at ASC NULLS LAST, created_at ASC
     LIMIT 1`,
    [subscriptionId]
  );
  return rows[0] || null;
}

// The operator's invoicing work queue: money received, factura still owed.
// Backs GET /v1/admin/invoicing/pending. invoiced_at (not invoice_document_id)
// is the signal — see the column comment in db/migrations/090 and CLAUDE.md
// Common Mistake #35.
//
// Carries everything needed to actually cut the invoice so the admin UI needs
// no follow-up lookups: the amounts, the period being billed, and the buyer's
// legal identity. business_name/ruc/main_address live on issuers, not tenants —
// any of a tenant's issuers carries the same RUC (branches share it), so the
// LATERAL picks the oldest active one (UUIDv7 ids are time-ordered, see ADR-020).
async function findPendingInvoice() {
  const { rows } = await db.query(
    `SELECT p.*,
            s.tenant_id, s.tier, s.billing_interval,
            s.current_period_start, s.current_period_end,
            t.email AS tenant_email,
            i.business_name, i.ruc, i.main_address
     FROM payments p
     JOIN subscriptions s ON s.id = p.subscription_id
     JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN LATERAL (
       SELECT business_name, ruc, main_address
       FROM issuers
       WHERE tenant_id = s.tenant_id AND active = true
       ORDER BY id
       LIMIT 1
     ) i ON true
     WHERE p.status = 'VERIFIED' AND p.invoiced_at IS NULL
     ORDER BY p.verified_at ASC NULLS LAST, p.created_at ASC`
  );
  return rows;
}

async function updateStatus(id, status, extraFields = {}) {
  for (const col of Object.keys(extraFields)) {
    if (!MUTABLE_EXTRA_COLUMNS.has(col)) {
      throw new Error(`payment.updateStatus: unknown column "${col}"`);
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
    `UPDATE payments SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] || null;
}

module.exports = {
  create,
  findById,
  findByIdAndTenantId,
  findBySubscriptionId,
  findAllByStatus,
  findPendingTierChangeBySubscriptionId,
  findPendingRenewalBySubscriptionId,
  findOldestUninvoicedBySubscriptionId,
  findPendingInvoice,
  updateStatus,
};
