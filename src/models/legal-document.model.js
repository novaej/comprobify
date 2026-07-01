const db = require('../config/database');
const { getClient } = db;

async function create({ documentType, version, contentMarkdown, contentHash }) {
  const { rows } = await db.query(
    `INSERT INTO legal_documents (document_type, version, content_markdown, content_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, document_type, version, content_markdown, content_hash, created_at, is_current`,
    [documentType, version, contentMarkdown, contentHash]
  );
  return rows[0];
}

// Activates a specific row as the current version for its document_type.
// Runs in a transaction: clears is_current on all other rows of the same
// type, then sets it on the target. This is the only path that sets is_current
// — create() never does, so every publish is a deliberate two-step.
async function activate(id) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: [target] } = await client.query(
      'SELECT * FROM legal_documents WHERE id = $1', [id]
    );
    if (!target) { await client.query('ROLLBACK'); return null; }
    await client.query(
      `UPDATE legal_documents SET is_current = false
       WHERE document_type = $1 AND is_current = true`,
      [target.document_type]
    );
    const { rows: [updated] } = await client.query(
      `UPDATE legal_documents SET is_current = true WHERE id = $1 RETURNING *`,
      [id]
    );
    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function findCurrentByType(documentType) {
  const { rows } = await db.query(
    `SELECT * FROM legal_documents WHERE document_type = $1 AND is_current = true`,
    [documentType]
  );
  return rows[0] || null;
}

async function findAllCurrent() {
  const { rows } = await db.query(
    `SELECT id, document_type, version, content_hash, created_at
     FROM legal_documents
     WHERE is_current = true
     ORDER BY document_type`
  );
  return rows;
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM legal_documents WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findAllByType(documentType) {
  const { rows } = await db.query(
    `SELECT id, document_type, version, is_current, created_at
     FROM legal_documents WHERE document_type = $1 ORDER BY created_at DESC`,
    [documentType]
  );
  return rows;
}

module.exports = { create, activate, findCurrentByType, findAllCurrent, findById, findAllByType };
