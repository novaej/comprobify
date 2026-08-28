const db = require('../config/database');

// One row per card-payment ATTEMPT against a payments row — see
// db/migrations/091. Plain db.query() (not issuer-scoped, no RLS), same
// precedent as payment.model.js/payment-proof.model.js.

const MUTABLE_COLUMNS = new Set([
  'payphone_transaction_id',
  'status_code',
  'authorization_code',
  'card_brand',
  'card_last_digits',
  'raw_confirm_response',
  'confirmed_at',
  'applied_at',
]);

async function create({ paymentId, clientTransactionId, amountCents }) {
  const { rows } = await db.query(
    `INSERT INTO payphone_transactions (payment_id, client_transaction_id, amount_cents)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [paymentId, clientTransactionId, amountCents]
  );
  return rows[0];
}

async function findByClientTransactionId(clientTransactionId) {
  const { rows } = await db.query(
    'SELECT * FROM payphone_transactions WHERE client_transaction_id = $1',
    [clientTransactionId]
  );
  return rows[0] || null;
}

// Claims the attempt row for the duration of the caller's transaction. The
// caller owns BEGIN/COMMIT — mirrors pending-effect.model.js's
// claimForProcessing(client, id). Holding this lock across the Payphone call is
// what makes a double-submitted return page safe: the second request blocks,
// then sees a terminal row and never issues a second confirm.
async function claimByClientTransactionId(client, clientTransactionId) {
  const { rows } = await client.query(
    'SELECT * FROM payphone_transactions WHERE client_transaction_id = $1 FOR UPDATE',
    [clientTransactionId]
  );
  return rows[0] || null;
}

// Takes an optional client so it can run inside the confirm transaction (the
// vendor outcome) or on the pool afterwards (stamping applied_at).
async function updateStatus(id, status, extraFields = {}, client = null) {
  for (const col of Object.keys(extraFields)) {
    if (!MUTABLE_COLUMNS.has(col)) {
      throw new Error(`payphoneTransaction.updateStatus: unknown column "${col}"`);
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

  const runner = client || db;
  const { rows } = await runner.query(
    `UPDATE payphone_transactions SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] || null;
}

// Reconciliation sweep 1: the payer's browser never reached the return page, so
// confirm was never called (or its transport failed). Payphone auto-reverses at
// 5 minutes, so anything older than that is worth a confirm purely to learn its
// final state.
async function findStalePending(minutes) {
  const { rows } = await db.query(
    `SELECT * FROM payphone_transactions
     WHERE status = 'PENDING'
       AND created_at <= NOW() - (INTERVAL '1 minute' * $1)
     ORDER BY created_at ASC`,
    [minutes]
  );
  return rows;
}

// Reconciliation sweep 2: the charge was captured and committed, but the
// process died before applyVerifiedPayment ran. Money in, tenant not credited.
async function findApprovedUnapplied() {
  const { rows } = await db.query(
    `SELECT * FROM payphone_transactions
     WHERE status = 'APPROVED' AND applied_at IS NULL
     ORDER BY confirmed_at ASC`
  );
  return rows;
}

module.exports = {
  create,
  findByClientTransactionId,
  claimByClientTransactionId,
  updateStatus,
  findStalePending,
  findApprovedUnapplied,
};
