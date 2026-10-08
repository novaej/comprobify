const db = require('../config/database');

async function create(documentId, eventType, fromStatus, toStatus, detail, client, issuerId = null, sandbox = false) {
  const params = [documentId, eventType, fromStatus || null, toStatus || null, detail ? JSON.stringify(detail) : null];

  let rows;
  if (client) {
    // client has search_path set via setIssuerContext — rely on it
    const sql = `INSERT INTO document_events (document_id, event_type, from_status, to_status, detail) VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    ({ rows } = await client.query(sql, params));
  } else {
    // queryAsIssuer sets search_path — rely on it
    const sql = `INSERT INTO document_events (document_id, event_type, from_status, to_status, detail) VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    ({ rows } = await db.queryAsIssuer(issuerId, sql, params, sandbox));
  }
  return rows[0];
}

async function findByDocumentId(documentId, issuerId, sandbox = false) {
  const sql = 'SELECT * FROM document_events WHERE document_id = $1 ORDER BY created_at ASC';
  const { rows } = await db.queryAsIssuer(issuerId, sql, [documentId], sandbox);
  return rows;
}

module.exports = { create, findByDocumentId };
