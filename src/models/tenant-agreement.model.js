const db = require('../config/database');

async function create({ tenantId, documentType, templateVersion, contentMarkdown, contentHash }) {
  const { rows } = await db.query(
    `INSERT INTO tenant_agreements
       (tenant_id, document_type, template_version, content_markdown, content_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, document_type, template_version) DO NOTHING
     RETURNING *`,
    [tenantId, documentType, templateVersion, contentMarkdown, contentHash]
  );
  return rows[0] || null;
}

// Latest document per type for this tenant (across all template versions).
async function findLatestByTenantAndType(tenantId, documentType) {
  const { rows } = await db.query(
    `SELECT * FROM tenant_agreements
     WHERE tenant_id = $1 AND document_type = $2
     ORDER BY generated_at DESC LIMIT 1`,
    [tenantId, documentType]
  );
  return rows[0] || null;
}

// All documents for this tenant, ordered newest first — for history view.
async function findAllByTenant(tenantId) {
  const { rows } = await db.query(
    `SELECT * FROM tenant_agreements
     WHERE tenant_id = $1
     ORDER BY document_type, generated_at DESC`,
    [tenantId]
  );
  return rows;
}

async function accept(id, { ip, userAgent }) {
  const { rows } = await db.query(
    `UPDATE tenant_agreements
     SET status = 'ACCEPTED', accepted_at = NOW(), ip = $2, user_agent = $3
     WHERE id = $1 AND status = 'PENDING'
     RETURNING *`,
    [id, ip || null, userAgent || null]
  );
  return rows[0] || null;
}

async function acceptAllPendingByTenant(tenantId, { ip, userAgent }) {
  const { rows } = await db.query(
    `UPDATE tenant_agreements
     SET status = 'ACCEPTED', accepted_at = NOW(), ip = $2, user_agent = $3
     WHERE tenant_id = $1 AND status = 'PENDING'
     RETURNING *`,
    [tenantId, ip || null, userAgent || null]
  );
  return rows;
}

module.exports = { create, findLatestByTenantAndType, findAllByTenant, accept, acceptAllPendingByTenant };
