const { XMLParser } = require('fast-xml-parser');
const documentModel = require('../models/document.model');
const issuerModel = require('../models/issuer.model');
const catalogModel = require('../models/catalog.model');
const rideBuilder = require('../../helpers/ride-builder');
const AppError = require('../errors/app-error');
const NotFoundError = require('../errors/not-found-error');
const DocumentStatus = require('../constants/document-status');
const ErrorCodes = require('../constants/error-codes');

// Repeating SRI elements that must always parse as arrays, even with a single occurrence.
const REPEATING_ELEMENTS = new Set(['detalle', 'campoAdicional', 'totalImpuesto', 'pago', 'impuesto']);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // SRI codes (claveAcceso, secuencial, estab, ruc, …) are zero-padded/high-precision digit
  // strings — auto-numeric parsing would corrupt them (e.g. strip leading zeros, lose
  // precision on the 49-digit access key), so every value is kept as a raw string.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => REPEATING_ELEMENTS.has(name),
});

function parseAdditionalInfo(infoAdicional) {
  const entries = infoAdicional?.campoAdicional || [];
  return entries.map((entry) => ({ name: entry['@_nombre'], value: entry['#text'] ?? '' }));
}

function parseTaxes(impuestos) {
  const entries = impuestos?.impuesto || [];
  return entries.map((tax) => ({ code: tax.codigo, rateCode: tax.codigoPorcentaje, rate: tax.tarifa }));
}

function parseItems(detalles, mainCodeTag, auxCodeTag) {
  const entries = detalles?.detalle || [];
  return entries.map((item) => ({
    mainCode: item[mainCodeTag],
    auxCode: item[auxCodeTag] || null,
    description: item.descripcion,
    quantity: item.cantidad,
    unitPrice: item.precioUnitario,
    discount: item.descuento,
    taxes: parseTaxes(item.impuestos),
  }));
}

function parsePayments(pagos) {
  const entries = pagos?.pago || [];
  return entries.map((p) => ({
    method: p.formaPago,
    total: p.total,
    ...(p.plazo !== undefined && { term: p.plazo }),
    ...(p.unidadTiempo !== undefined && { termUnit: p.unidadTiempo }),
  }));
}

// Maps a parsed <factura> document (SRI schema 2.1.0) to RIDE content fields.
function mapInvoiceXml(root) {
  const info = root.infoTributaria;
  const fac = root.infoFactura;
  return {
    ruc: info.ruc,
    businessName: info.razonSocial,
    tradeName: info.nombreComercial || null,
    mainAddress: info.dirMatriz,
    branchAddress: fac.dirEstablecimiento || null,
    specialTaxpayer: fac.contribuyenteEspecial || null,
    requiredAccounting: fac.obligadoContabilidad || null,
    branchCode: info.estab,
    issuePointCode: info.ptoEmi,
    emissionType: info.tipoEmision,
    environment: info.ambiente,
    documentType: info.codDoc,
    accessKey: info.claveAcceso,
    sequential: info.secuencial,
    buyerIdType: fac.tipoIdentificacionComprador,
    buyerName: fac.razonSocialComprador,
    buyerId: fac.identificacionComprador,
    buyerAddress: fac.direccionComprador || null,
    subtotal: fac.totalSinImpuestos,
    total: fac.importeTotal,
    propina: fac.propina,
    items: parseItems(root.detalles, 'codigoPrincipal', 'codigoAuxiliar'),
    payments: parsePayments(fac.pagos),
    originalDocument: null,
    motivo: null,
    additionalInfo: parseAdditionalInfo(root.infoAdicional),
  };
}

// Maps a parsed <notaCredito> document (SRI schema 1.1.0) to RIDE content fields.
function mapCreditNoteXml(root) {
  const info = root.infoTributaria;
  const nc = root.infoNotaCredito;
  return {
    ruc: info.ruc,
    businessName: info.razonSocial,
    tradeName: info.nombreComercial || null,
    mainAddress: info.dirMatriz,
    branchAddress: nc.dirEstablecimiento || null,
    specialTaxpayer: nc.contribuyenteEspecial || null,
    requiredAccounting: nc.obligadoContabilidad || null,
    branchCode: info.estab,
    issuePointCode: info.ptoEmi,
    emissionType: info.tipoEmision,
    environment: info.ambiente,
    documentType: info.codDoc,
    accessKey: info.claveAcceso,
    sequential: info.secuencial,
    buyerIdType: nc.tipoIdentificacionComprador,
    buyerName: nc.razonSocialComprador,
    buyerId: nc.identificacionComprador,
    buyerAddress: null,
    subtotal: nc.totalSinImpuestos,
    total: nc.valorModificacion,
    propina: null,
    items: parseItems(root.detalles, 'codigoInterno', 'codigoAdicional'),
    payments: [],
    originalDocument: {
      documentType: nc.codDocModificado,
      number: nc.numDocModificado,
      issueDate: nc.fechaEmisionDocSustento,
    },
    motivo: nc.motivo,
    additionalInfo: parseAdditionalInfo(root.infoAdicional),
  };
}

async function generate(accessKeyOrDocument, issuerOverride = null) {
  const document = typeof accessKeyOrDocument === 'string'
    ? await documentModel.findByAccessKey(accessKeyOrDocument, issuerOverride?.id || null, issuerOverride?.sandbox || false)
    : accessKeyOrDocument;

  if (!document) {
    throw new NotFoundError('Document');
  }
  if (document.status !== DocumentStatus.AUTHORIZED) {
    throw new AppError(
      `Cannot generate RIDE for document with status ${document.status}. Document must be ${DocumentStatus.AUTHORIZED}.`,
      400,
      ErrorCodes.DOCUMENT_NOT_AUTHORIZED
    );
  }

  const issuer = issuerOverride || await issuerModel.findById(document.issuer_id);

  // The RIDE is a printed representation of the document actually authorized by SRI —
  // it must be built from the same immutable XML GET /:key/xml serves, never
  // reconstructed from mutable request_payload/issuer/config joins that can drift after
  // authorization (e.g. an issuer edit, or a later fix to how additional-info fields are
  // built). Same fallback as document-query.service.js's getXml().
  const xmlSource = document.authorization_xml || document.signed_xml;
  if (!xmlSource) {
    throw new AppError(
      'Cannot generate RIDE: no authorized or signed XML is stored for this document.',
      500,
      ErrorCodes.RIDE_XML_UNAVAILABLE
    );
  }

  const parsed = xmlParser.parse(xmlSource);
  const root = parsed.factura || parsed.notaCredito;
  const mapped = document.document_type === '04' ? mapCreditNoteXml(root) : mapInvoiceXml(root);

  const idTypeLabel = await catalogModel.getIdTypeLabel(mapped.buyerIdType);

  const payments = await Promise.all(
    mapped.payments.map(async (p) => ({
      ...p,
      methodLabel: await catalogModel.getPaymentMethodLabel(p.method),
      ...(p.termUnit && { termUnitLabel: await catalogModel.getTermUnitLabel(p.termUnit) }),
    }))
  );

  const originalDocument = mapped.originalDocument
    ? {
      ...mapped.originalDocument,
      documentTypeLabel: await catalogModel.getDocumentTypeDescription(mapped.originalDocument.documentType),
    }
    : null;

  // Collect distinct tax rates and resolve descriptions
  const taxDescriptions = {};
  for (const item of mapped.items) {
    for (const tax of item.taxes) {
      const key = `${tax.code}|${tax.rateCode}`;
      if (!taxDescriptions[key]) {
        taxDescriptions[key] = await catalogModel.getTaxRateDescription(tax.code, tax.rateCode);
      }
    }
  }

  const rideData = {
    ...mapped,

    // Not part of the comprobante XML itself — metadata about the authorization event,
    // frozen on the documents row by the same DB trigger that freezes authorization_xml.
    authorizationNumber: document.authorization_number,
    authorizationDate: document.authorization_date,

    // Presentation-only, not content of the legal document — current issuer branding.
    logoBuffer: issuer.logo || null,

    // Catalog-resolved display labels, layered on top of the XML-sourced values above.
    buyerIdTypeLabel: idTypeLabel,
    payments,
    originalDocument,
    taxDescriptions,
  };

  return rideBuilder.build(rideData);
}

module.exports = { generate };
