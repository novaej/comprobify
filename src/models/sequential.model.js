const db = require('../config/database');

async function getNextValue(issuerId, branchCode, issuePointCode, documentType, client) {
  const q = client || db;

  // Try to update and return
  const { rows } = await q.query(
    `UPDATE sequential_numbers
     SET current_value = current_value + 1, updated_at = NOW()
     WHERE issuer_id = $1 AND branch_code = $2 AND issue_point_code = $3 AND document_type = $4
     RETURNING current_value`,
    [issuerId, branchCode, issuePointCode, documentType]
  );

  if (rows.length > 0) {
    return rows[0].current_value;
  }

  // Row doesn't exist yet — insert with value 1
  const { rows: inserted } = await q.query(
    `INSERT INTO sequential_numbers (issuer_id, branch_code, issue_point_code, document_type, current_value)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (issuer_id, branch_code, issue_point_code, document_type)
     DO UPDATE SET current_value = sequential_numbers.current_value + 1, updated_at = NOW()
     RETURNING current_value`,
    [issuerId, branchCode, issuePointCode, documentType]
  );

  return inserted[0].current_value;
}

module.exports = { getNextValue };
