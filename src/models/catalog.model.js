const db = require('../config/database');

const cache = {};

async function loadSet(key, query) {
  if (!cache[key]) {
    const { rows } = await db.query(query);
    cache[key] = new Set(rows.map((r) => Object.values(r).join('|')));
  }
  return cache[key];
}

async function loadMap(key, query) {
  if (!cache[key]) {
    const { rows } = await db.query(query);
    cache[key] = new Map(rows.map((r) => [r.key, r.label]));
  }
  return cache[key];
}

async function isValidIdType(code) {
  const set = await loadSet('idTypes', 'SELECT code FROM cat_id_types');
  return set.has(code);
}

async function isValidTaxType(code) {
  const set = await loadSet('taxTypes', 'SELECT code FROM cat_tax_types');
  return set.has(code);
}

async function isValidTaxRate(taxCode, rateCode) {
  const set = await loadSet(
    'taxRates',
    'SELECT tax_code || \'|\' || rate_code AS key FROM cat_tax_rates'
  );
  return set.has(`${taxCode}|${rateCode}`);
}

async function isValidPaymentMethod(code) {
  const set = await loadSet('paymentMethods', 'SELECT code FROM cat_payment_methods');
  return set.has(code);
}

async function getIdTypeLabel(code) {
  const map = await loadMap('idTypeLabels', "SELECT code AS key, description AS label FROM cat_id_types");
  return map.get(code) || code;
}

async function getPaymentMethodLabel(code) {
  const map = await loadMap('paymentMethodLabels', "SELECT code AS key, description AS label FROM cat_payment_methods");
  return map.get(code) || code;
}

async function getTaxRateDescription(taxCode, rateCode) {
  const map = await loadMap(
    'taxRateDescriptions',
    "SELECT (tax_code || '|' || rate_code) AS key, description AS label FROM cat_tax_rates"
  );
  return map.get(`${taxCode}|${rateCode}`) || rateCode;
}

module.exports = {
  isValidIdType,
  isValidTaxType,
  isValidTaxRate,
  isValidPaymentMethod,
  getIdTypeLabel,
  getPaymentMethodLabel,
  getTaxRateDescription,
};
