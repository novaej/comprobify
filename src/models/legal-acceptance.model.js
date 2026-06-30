const db = require('../config/database');

async function create({ tenantId, documentType, version, contentHash, ip, userAgent }) {
  const { rows } = await db.query(
    `INSERT INTO legal_acceptances (tenant_id, document_type, version, content_hash, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantId, documentType, version, contentHash, ip || null, userAgent || null]
  );
  return rows[0];
}

async function findLatestByTenantAndType(tenantId, documentType) {
  const { rows } = await db.query(
    `SELECT * FROM legal_acceptances
     WHERE tenant_id = $1 AND document_type = $2
     ORDER BY accepted_at DESC LIMIT 1`,
    [tenantId, documentType]
  );
  return rows[0] || null;
}

async function findAllByTenant(tenantId) {
  const { rows } = await db.query(
    `SELECT * FROM legal_acceptances WHERE tenant_id = $1 ORDER BY accepted_at DESC`,
    [tenantId]
  );
  return rows;
}

module.exports = { create, findLatestByTenantAndType, findAllByTenant };
