const db = require('../config/database');

async function create(documentId, eventType, fromStatus, toStatus, detail, client) {
  const q = client || db;
  const { rows } = await q.query(
    `INSERT INTO document_events (document_id, event_type, from_status, to_status, detail)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [documentId, eventType, fromStatus || null, toStatus || null, detail ? JSON.stringify(detail) : null]
  );
  return rows[0];
}

async function findByDocumentId(documentId) {
  const { rows } = await db.query(
    'SELECT * FROM document_events WHERE document_id = $1 ORDER BY created_at ASC',
    [documentId]
  );
  return rows;
}

module.exports = { create, findByDocumentId };
