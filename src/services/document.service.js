const moment = require('moment');
const config = require('../config');
const issuerModel = require('../models/issuer.model');
const documentModel = require('../models/document.model');
const invoiceDetailModel = require('../models/invoice-detail.model');
const documentEventModel = require('../models/document-event.model');
const clientModel = require('../models/client.model');
const sequentialService = require('./sequential.service');
const accessKeyService = require('./access-key.service');
const signingService = require('./signing.service');
const xmlValidator = require('./xml-validator.service');
const { getBuilder } = require('../builders');
const AppError = require('../errors/app-error');
const NotFoundError = require('../errors/not-found-error');
const ValidationError = require('../errors/validation-error');

const DOCUMENT_TYPE_INVOICE = '01';

async function getIssuer() {
  const issuer = await issuerModel.findFirst();
  if (!issuer) {
    throw new AppError('No active issuer configured', 500);
  }
  return issuer;
}

async function create(body) {
  const issuer = await getIssuer();
  const issueDate = body.issueDate || moment().format('DD/MM/YYYY');

  // Get next sequential with row-level locking
  const sequential = await sequentialService.getNext(
    issuer.id,
    issuer.branch_code,
    issuer.issue_point_code,
    DOCUMENT_TYPE_INVOICE
  );

  // Generate 49-digit SRI access key
  const accessKey = await accessKeyService.generate({
    issueDate,
    documentType: DOCUMENT_TYPE_INVOICE,
    ruc: issuer.ruc,
    environment: issuer.environment,
    branchCode: issuer.branch_code,
    issuePointCode: issuer.issue_point_code,
    sequential,
    emissionType: issuer.emission_type,
  });

  // Build XML
  const builder = getBuilder(DOCUMENT_TYPE_INVOICE, issuer);
  const unsignedXml = builder.build({ ...body, issueDate }, accessKey, sequential);

  // Validate against XSD before signing
  const xsdResult = xmlValidator.validate(unsignedXml);
  if (!xsdResult.valid) {
    throw new ValidationError(xsdResult.errors);
  }

  // Sign XML
  const signedXml = signingService.signXml(unsignedXml, issuer.cert_path, issuer.cert_password_enc);

  // Calculate totals for DB storage
  const subtotal = builder.subtotal;
  const total = builder.total;

  // Save to database
  const document = await documentModel.create({
    issuerId: issuer.id,
    documentType: DOCUMENT_TYPE_INVOICE,
    accessKey,
    sequential,
    branchCode: issuer.branch_code,
    issuePointCode: issuer.issue_point_code,
    issueDate: moment(issueDate, 'DD/MM/YYYY').toDate(),
    status: 'SIGNED',
    unsignedXml,
    signedXml,
    buyerId: body.buyer.id,
    buyerName: body.buyer.name,
    buyerIdType: body.buyer.idType,
    subtotal,
    total,
    requestPayload: body,
  });

  // Persist invoice line items
  await invoiceDetailModel.bulkCreate(document.id, body.items);

  // Log audit event
  await documentEventModel.create(document.id, 'CREATED', null, 'SIGNED', {
    accessKey,
    sequential,
  });

  // Upsert buyer into clients table (non-blocking — failure doesn't abort the invoice)
  clientModel.findOrCreate(issuer.id, body.buyer).catch((err) => {
    console.warn('Failed to upsert client record:', err.message);
  });

  return formatDocument(document);
}

async function getByAccessKey(accessKey) {
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) return null;
  return formatDocument(document);
}

async function sendToSri(accessKey) {
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) {
    throw new NotFoundError('Document');
  }
  if (document.status !== 'SIGNED') {
    throw new AppError(`Cannot send document with status ${document.status}. Must be SIGNED.`, 400);
  }

  const sriService = require('./sri.service');
  let result;
  try {
    result = await sriService.sendReceipt(document.signed_xml);
  } catch (err) {
    await documentEventModel.create(document.id, 'ERROR', document.status, null, {
      operation: 'SEND',
      message: err.message,
    });
    throw err;
  }

  const sriResponseModel = require('../models/sri-response.model');
  await sriResponseModel.create({
    documentId: document.id,
    operationType: 'RECEPTION',
    status: result.status,
    messages: result.messages,
    rawResponse: result.rawResponse,
  });

  const newStatus = result.status === 'RECIBIDA' ? 'RECEIVED' : 'RETURNED';
  const updated = await documentModel.updateStatus(document.id, newStatus);

  await documentEventModel.create(document.id, 'SENT', document.status, newStatus, {
    sriStatus: result.status,
  });

  return formatDocument(updated);
}

async function checkAuthorization(accessKey) {
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) {
    throw new NotFoundError('Document');
  }
  if (document.status !== 'RECEIVED') {
    throw new AppError(`Cannot check authorization for document with status ${document.status}. Must be RECEIVED.`, 400);
  }

  const sriService = require('./sri.service');
  let result;
  try {
    result = await sriService.checkAuthorization(accessKey);
  } catch (err) {
    await documentEventModel.create(document.id, 'ERROR', document.status, null, {
      operation: 'AUTHORIZE',
      message: err.message,
    });
    throw err;
  }

  const sriResponseModel = require('../models/sri-response.model');
  await sriResponseModel.create({
    documentId: document.id,
    operationType: 'AUTHORIZATION',
    status: result.status,
    messages: result.messages,
    rawResponse: result.rawResponse,
  });

  const newStatus = result.status === 'AUTORIZADO' ? 'AUTHORIZED' : 'NOT_AUTHORIZED';
  const extraFields = {};

  if (result.authorizationNumber) {
    extraFields.authorization_number = result.authorizationNumber;
  }
  if (result.authorizationDate) {
    extraFields.authorization_date = result.authorizationDate;
  }
  if (result.authorizationXml) {
    extraFields.authorization_xml = result.authorizationXml;
  }

  const updated = await documentModel.updateStatus(document.id, newStatus, extraFields);

  await documentEventModel.create(document.id, 'STATUS_CHANGED', document.status, newStatus, {
    sriStatus: result.status,
    authorizationNumber: result.authorizationNumber || null,
  });

  return formatDocument(updated);
}

function formatDocument(doc) {
  return {
    accessKey: doc.access_key,
    sequential: String(doc.sequential).padStart(9, '0'),
    status: doc.status,
    issueDate: moment(doc.issue_date).format('DD/MM/YYYY'),
    total: doc.total,
    ...(doc.authorization_number && { authorizationNumber: doc.authorization_number }),
    ...(doc.authorization_date && { authorizationDate: doc.authorization_date }),
  };
}

module.exports = { create, getByAccessKey, sendToSri, checkAuthorization };
