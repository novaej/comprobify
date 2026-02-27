const moment = require('moment');
const config = require('../config');
const issuerModel = require('../models/issuer.model');
const documentModel = require('../models/document.model');
const sequentialService = require('./sequential.service');
const accessKeyService = require('./access-key.service');
const signingService = require('./signing.service');
const { getBuilder } = require('../builders');
const AppError = require('../errors/app-error');
const NotFoundError = require('../errors/not-found-error');

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
  const result = await sriService.sendReceipt(document.signed_xml);

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
  const result = await sriService.checkAuthorization(accessKey);

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
