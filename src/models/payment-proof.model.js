const db = require('../config/database');

// Bulk inserts one row per uploaded file for a single submission attempt.
// Mirrors document-line-item.model.js's bulkCreate multi-row-insert pattern.
async function createMany(paymentId, files, referenceNumber) {
  if (!files || files.length === 0) return [];

  const COLS_PER_ROW = 5;
  const values = [];
  const placeholders = [];

  files.forEach((file, i) => {
    const offset = i * COLS_PER_ROW;
    placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
    values.push(paymentId, file.buffer, file.filename, file.mimeType, referenceNumber);
  });

  const { rows } = await db.query(
    `INSERT INTO payment_proofs (payment_id, file, filename, mime_type, reference_number)
     VALUES ${placeholders.join(', ')}
     RETURNING *`,
    values
  );
  return rows;
}

async function findActiveByPaymentId(paymentId) {
  const { rows } = await db.query(
    'SELECT * FROM payment_proofs WHERE payment_id = $1 AND active = true ORDER BY created_at ASC',
    [paymentId]
  );
  return rows;
}

// Admin-facing: includes soft-deleted rows too, for full audit visibility.
async function findAllByPaymentId(paymentId) {
  const { rows } = await db.query(
    'SELECT * FROM payment_proofs WHERE payment_id = $1 ORDER BY created_at ASC',
    [paymentId]
  );
  return rows;
}

async function findByIdAndPaymentId(id, paymentId) {
  const { rows } = await db.query(
    'SELECT * FROM payment_proofs WHERE id = $1 AND payment_id = $2',
    [id, paymentId]
  );
  return rows[0] || null;
}

async function countActiveByPaymentId(paymentId) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS count FROM payment_proofs WHERE payment_id = $1 AND active = true',
    [paymentId]
  );
  return rows[0].count;
}

// Soft delete only — never a hard DELETE (CLAUDE.md rule #7). Idempotent:
// a no-op (returns null) if the row doesn't exist, belongs to a different
// payment, or is already inactive.
async function softDelete(id, paymentId) {
  const { rows } = await db.query(
    `UPDATE payment_proofs SET active = false
     WHERE id = $1 AND payment_id = $2 AND active = true
     RETURNING *`,
    [id, paymentId]
  );
  return rows[0] || null;
}

module.exports = {
  createMany,
  findActiveByPaymentId,
  findAllByPaymentId,
  findByIdAndPaymentId,
  countActiveByPaymentId,
  softDelete,
};
