const documentModel = require('../models/document.model');
const issuerModel = require('../models/issuer.model');
const catalogModel = require('../models/catalog.model');
const rideBuilder = require('../../helpers/ride-builder');
const AppError = require('../errors/app-error');
const NotFoundError = require('../errors/not-found-error');
const DocumentStatus = require('../constants/document-status');

async function generate(accessKeyOrDocument, issuerOverride = null) {
  const document = typeof accessKeyOrDocument === 'string'
    ? await documentModel.findByAccessKey(accessKeyOrDocument, issuerOverride?.id || null)
    : accessKeyOrDocument;

  if (!document) {
    throw new NotFoundError('Document');
  }
  if (document.status !== DocumentStatus.AUTHORIZED) {
    throw new AppError(
      `Cannot generate RIDE for document with status ${document.status}. Must be ${DocumentStatus.AUTHORIZED}.`,
      400
    );
  }

  const issuer = issuerOverride || await issuerModel.findById(document.issuer_id);
  const payload = document.request_payload;

  // Resolve catalog labels for buyer id type
  const idTypeLabel = await catalogModel.getIdTypeLabel(document.buyer_id_type);

  // Resolve payment method labels
  const payments = await Promise.all(
    (payload.payments || []).map(async (p) => ({
      ...p,
      methodLabel: await catalogModel.getPaymentMethodLabel(p.method),
    }))
  );

  // Collect distinct tax rates and resolve descriptions
  // In the payload, the field is tax.code (not tax.taxCode)
  const taxDescriptions = {};
  for (const item of payload.items || []) {
    for (const tax of item.taxes || []) {
      const key = `${tax.code}|${tax.rateCode}`;
      if (!taxDescriptions[key]) {
        taxDescriptions[key] = await catalogModel.getTaxRateDescription(tax.code, tax.rateCode);
      }
    }
  }

  const rideData = {
    // Authorization strip
    authorizationNumber: document.authorization_number,
    authorizationDate: document.authorization_date,
    environment: issuer.environment, // '1' = PRUEBAS, '2' = PRODUCCIÓN

    // Issuer
    ruc: issuer.ruc,
    businessName: issuer.business_name,
    tradeName: issuer.trade_name || null,
    mainAddress: issuer.main_address,
    branchAddress: issuer.branch_address || null,
    specialTaxpayer: issuer.special_taxpayer || null,
    requiredAccounting: issuer.required_accounting || null,
    logoPath: issuer.logo_path || null,
    branchCode: issuer.branch_code,
    issuePointCode: issuer.issue_point_code,
    emissionType: issuer.emission_type,

    // Document
    accessKey: document.access_key,
    sequential: String(document.sequential).padStart(9, '0'),
    issueDate: document.issue_date,

    // Buyer
    buyerName: document.buyer_name,
    buyerId: document.buyer_id,
    buyerIdType: document.buyer_id_type,
    buyerIdTypeLabel: idTypeLabel,
    buyerAddress: payload.buyer?.address || null,

    // Items
    items: payload.items || [],

    // Payments
    payments,

    // Totals
    subtotal: document.subtotal,
    total: document.total,

    // Tax descriptions map (key = "taxCode|rateCode")
    taxDescriptions,

    // Additional info
    additionalInfo: payload.additionalInfo || null,
  };

  return rideBuilder.build(rideData);
}

module.exports = { generate };
