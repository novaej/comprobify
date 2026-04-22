const db = require('../config/database');

async function create({ documentId, operationType, status, messages, rawResponse, sandbox = false }) {
  const table = sandbox ? 'sandbox.sri_responses' : 'sri_responses';
  const { rows } = await db.query(
    `INSERT INTO ${table} (document_id, operation_type, status, messages, raw_response)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [documentId, operationType, status, messages ? JSON.stringify(messages) : null, rawResponse]
  );
  return rows[0];
}

async function findByDocumentId(documentId) {
  const { rows } = await db.query(
    'SELECT * FROM sri_responses WHERE document_id = $1 ORDER BY created_at DESC',
    [documentId]
  );
  return rows;
}

module.exports = { create, findByDocumentId };
