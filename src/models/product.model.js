const db = require('../config/database');

async function findByCode(issuerId, mainCode) {
  const { rows } = await db.query(
    'SELECT * FROM products WHERE issuer_id = $1 AND main_code = $2',
    [issuerId, mainCode]
  );
  return rows[0] || null;
}

async function upsert(issuerId, productData) {
  const { rows } = await db.query(
    `INSERT INTO products (issuer_id, main_code, aux_code, description, unit_price)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (issuer_id, main_code) DO UPDATE
       SET aux_code = EXCLUDED.aux_code,
           description = EXCLUDED.description,
           unit_price = EXCLUDED.unit_price,
           updated_at = NOW()
     RETURNING *`,
    [issuerId, productData.mainCode, productData.auxCode || null, productData.description, productData.unitPrice]
  );
  return rows[0];
}

module.exports = { findByCode, upsert };
