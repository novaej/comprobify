const db = require('../config/database');

async function create(tenantId, eventType, detail) {
  const sql = `INSERT INTO tenant_events (tenant_id, event_type, detail)
     VALUES ($1, $2, $3)
     RETURNING *`;
  const { rows } = await db.query(sql, [tenantId, eventType, detail ? JSON.stringify(detail) : null]);
  return rows[0];
}

async function findByTenantId(tenantId) {
  const sql = 'SELECT * FROM tenant_events WHERE tenant_id = $1 ORDER BY created_at ASC';
  const { rows } = await db.query(sql, [tenantId]);
  return rows;
}

module.exports = { create, findByTenantId };
