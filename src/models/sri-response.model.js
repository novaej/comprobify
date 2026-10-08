const db = require('../config/database');

// sri_responses is RLS-protected via its document — every call needs the owning issuer.
async function create({ documentId, operationType, status, messages, rawResponse, sandbox = false, issuerId }) {
  const { rows } = await db.queryAsIssuer(
    issuerId,
    `INSERT INTO sri_responses (document_id, operation_type, status, messages, raw_response)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [documentId, operationType, status, messages ? JSON.stringify(messages) : null, rawResponse],
    sandbox
  );
  return rows[0];
}

async function findByDocumentId(documentId, sandbox = false, issuerId) {
  const { rows } = await db.queryAsIssuer(
    issuerId,
    'SELECT * FROM sri_responses WHERE document_id = $1 ORDER BY created_at DESC',
    [documentId],
    sandbox
  );
  return rows;
}

module.exports = { create, findByDocumentId };
