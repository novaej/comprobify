const db = require('../config/database');

async function create({ billingInterval, priceUsd }) {
  const { rows } = await db.query(
    `INSERT INTO seat_prices (billing_interval, price_usd)
     VALUES ($1, $2)
     RETURNING *`,
    [billingInterval, priceUsd]
  );
  return rows[0];
}

async function updatePriceUsd(id, priceUsd) {
  const { rows } = await db.query(
    `UPDATE seat_prices SET price_usd = $2 WHERE id = $1 AND status = 'DRAFT' RETURNING *`,
    [id, priceUsd]
  );
  return rows[0] || null;
}

async function publish(id, effectiveAt) {
  const { rows } = await db.query(
    `UPDATE seat_prices
     SET status = 'PUBLISHED', effective_at = $2, published_at = NOW()
     WHERE id = $1 AND status = 'DRAFT'
     RETURNING *`,
    [id, effectiveAt]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM seat_prices WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findAll() {
  const { rows } = await db.query(`SELECT * FROM seat_prices ORDER BY created_at DESC`);
  return rows;
}

// Mirrors tier-price.model.js's findCurrent — no `tier` dimension, the price
// is flat across every tier.
async function findCurrent(billingInterval, asOfDate) {
  const { rows } = await db.query(
    `SELECT * FROM seat_prices
     WHERE billing_interval = $1 AND status = 'PUBLISHED' AND effective_at <= $2
     ORDER BY effective_at DESC
     LIMIT 1`,
    [billingInterval, asOfDate]
  );
  return rows[0] || null;
}

async function findUpcoming(billingInterval) {
  const { rows } = await db.query(
    `SELECT * FROM seat_prices
     WHERE billing_interval = $1 AND status = 'PUBLISHED' AND effective_at > NOW()
     ORDER BY effective_at ASC
     LIMIT 1`,
    [billingInterval]
  );
  return rows[0] || null;
}

// Mirrors tier-price.model.js's findUnnotifiedPendingForTenant, keyed by
// metadata->>'seatPriceId' instead of 'tierPriceId' — the two never collide,
// since a tier-price notification never sets seatPriceId and vice versa.
async function findUnnotifiedPendingForTenant(tenantId) {
  const { rows } = await db.query(
    `SELECT sp.*
     FROM seat_prices sp
     WHERE sp.status = 'PUBLISHED' AND sp.effective_at > NOW()
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.tenant_id = $1
           AND n.type = 'PRICE_CHANGE_ANNOUNCED'
           AND n.metadata->>'seatPriceId' = sp.id::text
       )`,
    [tenantId]
  );
  return rows;
}

module.exports = { create, updatePriceUsd, publish, findById, findAll, findCurrent, findUpcoming, findUnnotifiedPendingForTenant };
