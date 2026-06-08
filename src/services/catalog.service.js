const catalogModel = require('../models/catalog.model');

async function listIdTypes() {
  return catalogModel.listIdTypes();
}

async function listPaymentMethods() {
  return catalogModel.listPaymentMethods();
}

async function listTermUnits() {
  return catalogModel.listTermUnits();
}

async function listTaxTypes() {
  return catalogModel.listTaxTypes();
}

async function listTaxRates() {
  return catalogModel.listTaxRates();
}

module.exports = { listIdTypes, listPaymentMethods, listTermUnits, listTaxTypes, listTaxRates };
