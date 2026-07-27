const db = require('../config/database');

async function create({ tier, billingInterval, priceUsd }) {
  const { rows } = await db.query(
    `INSERT INTO tier_prices (tier, billing_interval, price_usd)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [tier, billingInterval, priceUsd]
  );
  return rows[0];
}

// Only ever updates a DRAFT row's price — publish() is the only path that
// touches status/effective_at/published_at, and a PUBLISHED row is otherwise
// immutable (same as an agreements version).
async function updatePriceUsd(id, priceUsd) {
  const { rows } = await db.query(
    `UPDATE tier_prices SET price_usd = $2 WHERE id = $1 AND status = 'DRAFT' RETURNING *`,
    [id, priceUsd]
  );
  return rows[0] || null;
}

async function publish(id, effectiveAt) {
  const { rows } = await db.query(
    `UPDATE tier_prices
     SET status = 'PUBLISHED', effective_at = $2, published_at = NOW()
     WHERE id = $1 AND status = 'DRAFT'
     RETURNING *`,
    [id, effectiveAt]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM tier_prices WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findAll({ tier } = {}) {
  if (tier) {
    const { rows } = await db.query(
      `SELECT * FROM tier_prices WHERE tier = $1 ORDER BY created_at DESC`,
      [tier]
    );
    return rows;
  }
  const { rows } = await db.query(`SELECT * FROM tier_prices ORDER BY created_at DESC`);
  return rows;
}

// The historical resolver every real billing call site uses: the newest
// PUBLISHED row whose effective_at has already passed as of asOfDate. Always
// resolves to a row post-migration-076 seed (every tier/interval combo has a
// PUBLISHED row effective from 2020-01-01), so a null here indicates a bug,
// not a legitimate "no price set yet" state.
async function findCurrent(tier, billingInterval, asOfDate) {
  const { rows } = await db.query(
    `SELECT * FROM tier_prices
     WHERE tier = $1 AND billing_interval = $2 AND status = 'PUBLISHED' AND effective_at <= $3
     ORDER BY effective_at DESC
     LIMIT 1`,
    [tier, billingInterval, asOfDate]
  );
  return rows[0] || null;
}

// Earliest still-pending price change for a tier/interval — used by
// GET /v1/tiers to show a change before it takes effect.
async function findUpcoming(tier, billingInterval) {
  const { rows } = await db.query(
    `SELECT * FROM tier_prices
     WHERE tier = $1 AND billing_interval = $2 AND status = 'PUBLISHED' AND effective_at > NOW()
     ORDER BY effective_at ASC
     LIMIT 1`,
    [tier, billingInterval]
  );
  return rows[0] || null;
}

// Every PUBLISHED price still inside its notice window (effective_at in the
// future) this tenant has no PRICE_CHANGE_ANNOUNCED notification for yet.
// Safe to use notifications as the idempotency source only because that type
// is "mandatory" (see migration 076's comment) — its row is created
// unconditionally, so its existence is a reliable "already handled" signal.
// Called by pricingService.notifyPendingPriceChangesForTenant — the publish-
// time bulk blast, the reactivation catch-up hooks, and the periodic
// reconciliation sweep all go through this same check.
async function findUnnotifiedPendingForTenant(tenantId) {
  const { rows } = await db.query(
    `SELECT tp.*
     FROM tier_prices tp
     WHERE tp.status = 'PUBLISHED' AND tp.effective_at > NOW()
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.tenant_id = $1
           AND n.type = 'PRICE_CHANGE_ANNOUNCED'
           AND n.metadata->>'tierPriceId' = tp.id::text
       )`,
    [tenantId]
  );
  return rows;
}

module.exports = { create, updatePriceUsd, publish, findById, findAll, findCurrent, findUpcoming, findUnnotifiedPendingForTenant };
