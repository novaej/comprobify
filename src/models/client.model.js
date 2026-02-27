const db = require('../config/database');

async function findByIdentifier(issuerId, identifier) {
  const { rows } = await db.query(
    'SELECT * FROM clients WHERE issuer_id = $1 AND identifier = $2',
    [issuerId, identifier]
  );
  return rows[0] || null;
}

async function findOrCreate(issuerId, buyerData) {
  const existing = await findByIdentifier(issuerId, buyerData.id);
  if (existing) return existing;

  const { rows } = await db.query(
    `INSERT INTO clients (issuer_id, id_type, identifier, name, address, email)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (issuer_id, identifier) DO UPDATE
       SET name = EXCLUDED.name,
           address = EXCLUDED.address,
           updated_at = NOW()
     RETURNING *`,
    [issuerId, buyerData.idType, buyerData.id, buyerData.name, buyerData.address || null, buyerData.email || null]
  );
  return rows[0];
}

module.exports = { findByIdentifier, findOrCreate };
