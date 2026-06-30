const db = require('../config/database');

const MUTABLE_EXTRA_COLUMNS = new Set([
  'reported_at',
  'verified_at',
  'proof_file',
  'proof_filename',
  'proof_mime_type',
  'period_start',
  'period_end',
  'rejection_reason',
  'invoice_document_id',
]);

async function create({ subscriptionId, amount, method = 'SPI_TRANSFER', purpose = 'INITIAL', targetTier = null }) {
  const { rows } = await db.query(
    `INSERT INTO payments (subscription_id, amount, method, purpose, target_tier)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [subscriptionId, amount, method, purpose, targetTier]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM payments WHERE id = $1', [id]);
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
    `SELECT p.*, s.tenant_id, s.tier, s.billing_interval
     FROM payments p
     JOIN subscriptions s ON s.id = p.subscription_id
     WHERE p.status = $1
     ORDER BY p.reported_at ASC NULLS LAST, p.created_at ASC`,
    [status]
  );
  return rows;
}

// Finds an in-flight (not yet rejected/refunded) tier-change payment for a
// subscription that hasn't had its invoice linked yet — used both to block a
// second concurrent tier-change request and, once VERIFIED, to find the
// payment linkInvoice should attach the self-billed invoice to.
async function findPendingTierChangeBySubscriptionId(subscriptionId) {
  const { rows } = await db.query(
    `SELECT * FROM payments
     WHERE subscription_id = $1 AND purpose = 'TIER_CHANGE'
       AND invoice_document_id IS NULL
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
// attach the self-billed invoice to once VERIFIED.
async function findPendingRenewalBySubscriptionId(subscriptionId) {
  const { rows } = await db.query(
    `SELECT * FROM payments
     WHERE subscription_id = $1 AND purpose = 'RENEWAL'
       AND invoice_document_id IS NULL
       AND status IN ('PENDING', 'REPORTED', 'VERIFIED')
     ORDER BY created_at DESC
     LIMIT 1`,
    [subscriptionId]
  );
  return rows[0] || null;
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
  findBySubscriptionId,
  findByInvoiceDocumentId,
  findAllByStatus,
  findPendingTierChangeBySubscriptionId,
  findPendingRenewalBySubscriptionId,
  updateStatus,
};
