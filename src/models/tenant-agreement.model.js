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

// Only accepts the row matching each document_type's currently-published
// version (agreements.is_current = true) — a stale PENDING row left over
// from a template that was republished before the tenant accepted the prior
// version must never be swept up here, since the tenant was never shown its
// content. See ADR-018 addendum on this exact bug.
async function acceptAllPendingByTenant(tenantId, { ip, userAgent }) {
  const { rows } = await db.query(
    `UPDATE tenant_agreements ta
     SET status = 'ACCEPTED', accepted_at = NOW(), ip = $2, user_agent = $3
     FROM agreements a
     WHERE ta.tenant_id = $1
       AND ta.status = 'PENDING'
       AND a.is_current = true
       AND a.document_type = ta.document_type
       AND a.version = ta.template_version
     RETURNING ta.*`,
    [tenantId, ip || null, userAgent || null]
  );
  return rows;
}

module.exports = { create, findLatestByTenantAndType, findAllByTenant, accept, acceptAllPendingByTenant };
