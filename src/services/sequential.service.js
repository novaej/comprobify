const db = require('../config/database');

/**
 * Returns the next sequential number for a given issuer/branch/point/docType.
 *
 * When called with an external `client` (already inside a transaction), the
 * UPDATE/INSERT runs inside that transaction. The sequential is only committed
 * when the caller commits — so if the caller rolls back (e.g. XSD validation
 * fails, signing fails, or the document INSERT fails), the sequential is rolled
 * back too and is never consumed.
 *
 * When called without a client, the function manages its own transaction
 * (used in isolation, e.g. tests or scripts).
 */
async function getNext(issuerId, branchCode, issuePointCode, documentType, client) {
  const ownTransaction = !client;
  const conn = client || await db.getClient();

  try {
    if (ownTransaction) {
      await conn.query('BEGIN');
      await db.setIssuerContext(conn, issuerId);
    }

    const { rows } = await conn.query(
      `SELECT current_value FROM sequential_numbers
       WHERE issuer_id = $1 AND branch_code = $2 AND issue_point_code = $3 AND document_type = $4
       FOR UPDATE`,
      [issuerId, branchCode, issuePointCode, documentType]
    );

    let nextValue;

    if (rows.length > 0) {
      nextValue = rows[0].current_value + 1;
      await conn.query(
        `UPDATE sequential_numbers SET current_value = $1, updated_at = NOW()
         WHERE issuer_id = $2 AND branch_code = $3 AND issue_point_code = $4 AND document_type = $5`,
        [nextValue, issuerId, branchCode, issuePointCode, documentType]
      );
    } else {
      nextValue = 1;
      await conn.query(
        `INSERT INTO sequential_numbers (issuer_id, branch_code, issue_point_code, document_type, current_value)
         VALUES ($1, $2, $3, $4, $5)`,
        [issuerId, branchCode, issuePointCode, documentType, nextValue]
      );
    }

    if (ownTransaction) await conn.query('COMMIT');
    return nextValue;
  } catch (err) {
    if (ownTransaction) await conn.query('ROLLBACK');
    throw err;
  } finally {
    if (ownTransaction) conn.release();
  }
}

/**
 * Seeds the starting position for a sequential counter.
 *
 * Sets current_value to startingValue - 1 so that the first call to getNext()
 * returns exactly startingValue. Use when migrating an issuer that has already
 * issued documents — pass the next unused sequential to avoid gaps or conflicts.
 *
 * Safe to call on a new issuer (no row yet) or to override an existing counter
 * before any documents have been created.
 *
 * @param {number} issuerId
 * @param {string} branchCode
 * @param {string} issuePointCode
 * @param {string} documentType
 * @param {number} startingValue - The first sequential that getNext() will return
 */
async function initialize(issuerId, branchCode, issuePointCode, documentType, startingValue) {
  await db.query(
    `INSERT INTO sequential_numbers (issuer_id, branch_code, issue_point_code, document_type, current_value)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (issuer_id, branch_code, issue_point_code, document_type)
     DO UPDATE SET current_value = $5, updated_at = NOW()`,
    [issuerId, branchCode, issuePointCode, documentType, startingValue - 1]
  );
}

module.exports = { getNext, initialize };
