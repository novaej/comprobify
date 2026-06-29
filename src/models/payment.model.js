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
]);

async function create({ subscriptionId, amount, method = 'SPI_TRANSFER' }) {
  const { rows } = await db.query(
    `INSERT INTO payments (subscription_id, amount, method)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [subscriptionId, amount, method]
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

module.exports = { create, findById, findBySubscriptionId, updateStatus };
