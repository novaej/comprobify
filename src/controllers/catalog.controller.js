const catalogService = require('../services/catalog.service');

const listIdTypes = async (req, res) => {
  const idTypes = await catalogService.listIdTypes();
  res.json({ ok: true, idTypes });
};

const listPaymentMethods = async (req, res) => {
  const paymentMethods = await catalogService.listPaymentMethods();
  res.json({ ok: true, paymentMethods });
};

const listTaxTypes = async (req, res) => {
  const taxTypes = await catalogService.listTaxTypes();
  res.json({ ok: true, taxTypes });
};

const listTaxRates = async (req, res) => {
  const taxRates = await catalogService.listTaxRates();
  res.json({ ok: true, taxRates });
};

module.exports = { listIdTypes, listPaymentMethods, listTaxTypes, listTaxRates };
