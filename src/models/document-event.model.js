const db = require('../config/database');

async function create(documentId, eventType, fromStatus, toStatus, detail, client, issuerId = null, sandbox = false) {
  const sql = `INSERT INTO document_events (document_id, event_type, from_status, to_status, detail)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`;
  const params = [documentId, eventType, fromStatus || null, toStatus || null, detail ? JSON.stringify(detail) : null];

  let rows;
  if (client) {
    ({ rows } = await client.query(sql, params));
  } else if (issuerId != null) {
    ({ rows } = await db.queryAsIssuer(issuerId, sql, params, sandbox));
  } else {
    // Bypass mode: webhook or other non-issuer-scoped callers
    ({ rows } = await db.query(sql, params));
  }
  return rows[0];
}

async function findByDocumentId(documentId, issuerId = null, sandbox = false) {
  const sql = 'SELECT * FROM document_events WHERE document_id = $1 ORDER BY created_at ASC';
  const { rows } = issuerId != null
    ? await db.queryAsIssuer(issuerId, sql, [documentId], sandbox)
    : await db.query(sql, [documentId]);
  return rows;
}

module.exports = { create, findByDocumentId };
