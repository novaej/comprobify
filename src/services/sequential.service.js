const db = require('../config/database');

async function getNext(issuerId, branchCode, issuePointCode, documentType) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Lock the row for this specific issuer/branch/point/docType
    const { rows } = await client.query(
      `SELECT current_value FROM sequential_numbers
       WHERE issuer_id = $1 AND branch_code = $2 AND issue_point_code = $3 AND document_type = $4
       FOR UPDATE`,
      [issuerId, branchCode, issuePointCode, documentType]
    );

    let nextValue;

    if (rows.length > 0) {
      nextValue = rows[0].current_value + 1;
      await client.query(
        `UPDATE sequential_numbers SET current_value = $1, updated_at = NOW()
         WHERE issuer_id = $2 AND branch_code = $3 AND issue_point_code = $4 AND document_type = $5`,
        [nextValue, issuerId, branchCode, issuePointCode, documentType]
      );
    } else {
      nextValue = 1;
      await client.query(
        `INSERT INTO sequential_numbers (issuer_id, branch_code, issue_point_code, document_type, current_value)
         VALUES ($1, $2, $3, $4, $5)`,
        [issuerId, branchCode, issuePointCode, documentType, nextValue]
      );
    }

    await client.query('COMMIT');
    return nextValue;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getNext };
