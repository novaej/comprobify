const db = require('../config/database');

// One row per card-payment attempt (migration 091). Not issuer-scoped, no RLS.

const MUTABLE_COLUMNS = new Set([
  'payphone_transaction_id',
  'status_code',
  'authorization_code',
  'card_brand',
  'card_last_digits',
  'confirm_response',
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

// Caller owns BEGIN/COMMIT. Holding this across the vendor call is what makes
// a double-submitted return page safe.
async function claimByClientTransactionId(client, clientTransactionId) {
  const { rows } = await client.query(
    'SELECT * FROM payphone_transactions WHERE client_transaction_id = $1 FOR UPDATE',
    [clientTransactionId]
  );
  return rows[0] || null;
}

// Optional client: inside the confirm transaction, or on the pool afterwards.
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

// Live attempts for one payment — anything not yet resolved either way.
async function countPendingByPaymentId(paymentId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count FROM payphone_transactions
     WHERE payment_id = $1 AND status = 'PENDING'`,
    [paymentId]
  );
  return rows[0].count;
}

// Sweep 1: confirm never fired. Worth asking Payphone how the charge ended.
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

// Sweep 2: captured but never applied — money in, tenant not credited.
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
  countPendingByPaymentId,
  findStalePending,
  findApprovedUnapplied,
};
