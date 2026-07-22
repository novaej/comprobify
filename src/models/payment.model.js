const db = require('../config/database');

const MUTABLE_EXTRA_COLUMNS = new Set([
  'reported_at',
  'verified_at',
  'period_start',
  'period_end',
  'rejection_reason_code',
  'invoice_document_id',
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

async function findByInvoiceDocumentId(documentId) {
  const { rows } = await db.query('SELECT * FROM payments WHERE invoice_document_id = $1', [documentId]);
  return rows[0] || null;
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
// subscription that hasn't been applied yet — used both to block a second
// concurrent tier-change request and, once VERIFIED, to find the payment
// linkInvoice should attach the self-billed invoice to. period_start IS NULL
// is the applied/unapplied signal, not invoice_document_id — a sandbox
// document never gets invoice_document_id stored (see linkSandboxDocument),
// but period_start IS always stamped once the payment has been applied, in
// both environments.
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
// used both to avoid creating a second renewal payment for the same upcoming
// period (processDueRenewals) and to find the payment linkInvoice should
// attach the self-billed invoice to once VERIFIED. See the comment above for
// why period_start, not invoice_document_id, is the applied/unapplied signal.
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

// VERIFIED TIER_CHANGE/RENEWAL payments still unapplied (period_start IS
// NULL — see the comment above for why that's the signal, not
// invoice_document_id) whose linked invoice has since become AUTHORIZED —
// the case linkInvoice() couldn't apply immediately because the invoice
// wasn't authorized yet at link time. Mirrors
// subscriptionModel.findPendingActivationWithAuthorizedDocument(); see
// ADR-022's addendum. invoice_document_id only ever references
// public.documents (never set for sandbox-linked documents).
async function findPendingApplicationWithAuthorizedDocument() {
  const { rows } = await db.query(
    `SELECT p.* FROM payments p
     JOIN documents d ON d.id = p.invoice_document_id
     WHERE p.purpose IN ('TIER_CHANGE', 'RENEWAL')
       AND p.status = 'VERIFIED'
       AND p.period_start IS NULL
       AND d.status = 'AUTHORIZED'`
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
  findByInvoiceDocumentId,
  findAllByStatus,
  findPendingTierChangeBySubscriptionId,
  findPendingRenewalBySubscriptionId,
  findPendingApplicationWithAuthorizedDocument,
  updateStatus,
};
