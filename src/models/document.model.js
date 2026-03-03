const db = require('../config/database');
const DocumentStatus = require('../constants/document-status');

const MUTABLE_EXTRA_COLUMNS = new Set([
  // Email tracking — always updatable
  'email_status', 'email_sent_at', 'email_error', 'email_message_id',
  // Authorization data — set once by checkAuthorization
  'authorization_xml', 'authorization_number', 'authorization_date',
  // Rebuild data — updated only when transitioning back to SIGNED
  'unsigned_xml', 'signed_xml', 'request_payload', 'subtotal', 'total',
  'buyer_id', 'buyer_name', 'buyer_id_type',
]);

async function create({ issuerId, documentType, accessKey, sequential, branchCode, issuePointCode, issueDate, status, unsignedXml, signedXml, buyerId, buyerName, buyerIdType, subtotal, total, requestPayload, buyerEmail, idempotencyKey, payloadHash }, client) {
  const q = client || db;
  const { rows } = await q.query(
    `INSERT INTO documents
      (issuer_id, document_type, access_key, sequential, branch_code, issue_point_code, issue_date, status, unsigned_xml, signed_xml, buyer_id, buyer_name, buyer_id_type, subtotal, total, request_payload, buyer_email, idempotency_key, payload_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [issuerId, documentType, accessKey, sequential, branchCode, issuePointCode, issueDate, status || DocumentStatus.SIGNED, unsignedXml, signedXml, buyerId, buyerName, buyerIdType, subtotal, total, requestPayload ? JSON.stringify(requestPayload) : null, buyerEmail || null, idempotencyKey || null, payloadHash || null]
  );
  return rows[0];
}

async function findByAccessKey(accessKey, issuerId = null) {
  const query = issuerId
    ? 'SELECT * FROM documents WHERE access_key = $1 AND issuer_id = $2'
    : 'SELECT * FROM documents WHERE access_key = $1';
  const params = issuerId ? [accessKey, issuerId] : [accessKey];
  const { rows } = await db.query(query, params);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM documents WHERE id = $1', [id]);
  return rows[0] || null;
}

async function updateStatus(id, status, extraFields = {}) {
  for (const col of Object.keys(extraFields)) {
    if (!MUTABLE_EXTRA_COLUMNS.has(col)) {
      throw new Error(`updateStatus: unknown column "${col}"`);
    }
  }

  const sets = ['status = $2', 'updated_at = NOW()'];
  const params = [id, status];
  let idx = 3;

  for (const [col, val] of Object.entries(extraFields)) {
    sets.push(`${col} = $${idx}`);
    params.push(val);
    idx++;
  }

  const { rows } = await db.query(
    `UPDATE documents SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] || null;
}

async function findByIdempotencyKey(key) {
  const { rows } = await db.query(
    'SELECT * FROM documents WHERE idempotency_key = $1',
    [key]
  );
  return rows[0] || null;
}

async function findByEmailMessageId(messageId) {
  const { rows } = await db.query(
    'SELECT * FROM documents WHERE email_message_id = $1',
    [messageId]
  );
  return rows[0] || null;
}

async function updateEmailStatus(id, emailStatus) {
  const { rows } = await db.query(
    `UPDATE documents SET email_status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, emailStatus]
  );
  return rows[0] || null;
}

async function findPendingEmails(issuerId) {
  const { rows } = await db.query(
    `SELECT * FROM documents
     WHERE  issuer_id = $1
       AND  status = 'AUTHORIZED'
       AND  email_status IN ('PENDING', 'FAILED')
       AND  buyer_email IS NOT NULL
     ORDER BY created_at ASC
     LIMIT 100`,
    [issuerId]
  );
  return rows;
}

module.exports = { create, findByAccessKey, findById, updateStatus, findPendingEmails, findByIdempotencyKey, findByEmailMessageId, updateEmailStatus };
