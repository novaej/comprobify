const db = require('../config/database');
const DocumentStatus = require('../constants/document-status');

async function create({ issuerId, documentType, accessKey, sequential, branchCode, issuePointCode, issueDate, status, unsignedXml, signedXml, buyerId, buyerName, buyerIdType, subtotal, total, requestPayload }, client) {
  const q = client || db;
  const { rows } = await q.query(
    `INSERT INTO documents
      (issuer_id, document_type, access_key, sequential, branch_code, issue_point_code, issue_date, status, unsigned_xml, signed_xml, buyer_id, buyer_name, buyer_id_type, subtotal, total, request_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [issuerId, documentType, accessKey, sequential, branchCode, issuePointCode, issueDate, status || DocumentStatus.SIGNED, unsignedXml, signedXml, buyerId, buyerName, buyerIdType, subtotal, total, requestPayload ? JSON.stringify(requestPayload) : null]
  );
  return rows[0];
}

async function findByAccessKey(accessKey) {
  const { rows } = await db.query('SELECT * FROM documents WHERE access_key = $1', [accessKey]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM documents WHERE id = $1', [id]);
  return rows[0] || null;
}

async function updateStatus(id, status, extraFields = {}) {
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

module.exports = { create, findByAccessKey, findById, updateStatus };
