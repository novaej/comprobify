const db = require('../config/database');

const MUTABLE_EXTRA_COLUMNS = new Set([
  'invoice_document_id',
  'current_period_start',
  'current_period_end',
  'canceled_at',
]);

async function create({ tenantId, tier }) {
  const { rows } = await db.query(
    `INSERT INTO subscriptions (tenant_id, tier)
     VALUES ($1, $2)
     RETURNING *`,
    [tenantId, tier]
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
  updateStatus,
};
