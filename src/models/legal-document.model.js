const db = require('../config/database');

async function create({ documentType, version, content, contentType }) {
  const { rows } = await db.query(
    `INSERT INTO legal_documents (document_type, version, content, content_type)
     VALUES ($1, $2, $3, $4)
     RETURNING id, document_type, version, content_type, created_at`,
    [documentType, version, content, contentType]
  );
  return rows[0];
}

async function findCurrentByType(documentType) {
  const { rows } = await db.query(
    `SELECT * FROM legal_documents WHERE document_type = $1 ORDER BY created_at DESC LIMIT 1`,
    [documentType]
  );
  return rows[0] || null;
}

async function findAllCurrent() {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (document_type) id, document_type, version, content_type, created_at
     FROM legal_documents
     ORDER BY document_type, created_at DESC`
  );
  return rows;
}

module.exports = { create, findCurrentByType, findAllCurrent };
