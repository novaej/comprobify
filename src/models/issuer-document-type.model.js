const db = require('../config/database');

async function bulkCreate(issuerId, documentTypes) {
  for (const documentType of documentTypes) {
    await db.query(
      `INSERT INTO issuer_document_types (issuer_id, document_type)
       VALUES ($1, $2)
       ON CONFLICT (issuer_id, document_type)
       DO UPDATE SET active = true`,
      [issuerId, documentType]
    );
  }
}

async function findActiveByIssuerId(issuerId) {
  const { rows } = await db.query(
    `SELECT document_type FROM issuer_document_types
     WHERE issuer_id = $1 AND active = true
     ORDER BY document_type`,
    [issuerId]
  );
  return rows.map(r => r.document_type);
}

async function activate(issuerId, documentType) {
  await db.query(
    `INSERT INTO issuer_document_types (issuer_id, document_type)
     VALUES ($1, $2)
     ON CONFLICT (issuer_id, document_type)
     DO UPDATE SET active = true`,
    [issuerId, documentType]
  );
}

async function deactivate(issuerId, documentType) {
  await db.query(
    `UPDATE issuer_document_types SET active = false
     WHERE issuer_id = $1 AND document_type = $2`,
    [issuerId, documentType]
  );
}

module.exports = { bulkCreate, findActiveByIssuerId, activate, deactivate };
