const moment = require('moment');
const config = require('../config');
const db = require('../config/database');
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
const DocumentStatus = require('../constants/document-status');
const EventType = require('../constants/event-type');
const OperationType = require('../constants/operation-type');

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

  // Open a single transaction that covers sequential assignment, XML build/validate/sign,
  // and all INSERTs. If anything fails the entire transaction rolls back — the sequential
  // is never committed and can be reused by the next request.
  // The sequential is only consumed once the document row is persisted and committed.
  const client = await db.getClient();

  let document;
  try {
    await client.query('BEGIN');

    // Get next sequential within this transaction (FOR UPDATE, not yet committed)
    const sequential = await sequentialService.getNext(
      issuer.id,
      issuer.branch_code,
      issuer.issue_point_code,
      DOCUMENT_TYPE_INVOICE,
      client
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

    // Validate against XSD — throws ValidationError if invalid, rolls back transaction
    const xsdResult = xmlValidator.validate(unsignedXml);
    if (!xsdResult.valid) {
      throw new ValidationError(xsdResult.errors);
    }

    // Sign XML — throws if certificate is expired or invalid, rolls back transaction
    const signedXml = signingService.signXml(unsignedXml, issuer.cert_path, issuer.cert_password_enc);

    // Save document within the same transaction
    document = await documentModel.create({
      issuerId: issuer.id,
      documentType: DOCUMENT_TYPE_INVOICE,
      accessKey,
      sequential,
      branchCode: issuer.branch_code,
      issuePointCode: issuer.issue_point_code,
      issueDate: moment(issueDate, 'DD/MM/YYYY').toDate(),
      status: DocumentStatus.SIGNED,
      unsignedXml,
      signedXml,
      buyerId: body.buyer.id,
      buyerName: body.buyer.name,
      buyerIdType: body.buyer.idType,
      subtotal: builder.subtotal,
      total: builder.total,
      requestPayload: body,
    }, client);

    // Persist invoice line items within the same transaction
    await invoiceDetailModel.bulkCreate(document.id, body.items, client);

    // Log audit event within the same transaction
    await documentEventModel.create(document.id, EventType.CREATED, null, DocumentStatus.SIGNED, {
      accessKey,
      sequential,
    }, client);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Fire-and-forget buyer upsert — runs after commit, failure never affects the invoice
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
  if (document.status !== DocumentStatus.SIGNED) {
    throw new AppError(`Cannot send document with status ${document.status}. Must be ${DocumentStatus.SIGNED}.`, 400);
  }

  const issuer = await issuerModel.findById(document.issuer_id);
  const sriService = require('./sri.service');
  let result;
  try {
    result = await sriService.sendReceipt(document.signed_xml, issuer.environment);
  } catch (err) {
    await documentEventModel.create(document.id, EventType.ERROR, document.status, null, {
      operation: 'SEND',
      message: err.message,
    });
    throw err;
  }

  const sriResponseModel = require('../models/sri-response.model');
  await sriResponseModel.create({
    documentId: document.id,
    operationType: OperationType.RECEPTION,
    status: result.status,
    messages: result.messages,
    rawResponse: result.rawResponse,
  });

  const newStatus = result.status === 'RECIBIDA' ? DocumentStatus.RECEIVED : DocumentStatus.RETURNED;
  const updated = await documentModel.updateStatus(document.id, newStatus);

  await documentEventModel.create(document.id, EventType.SENT, document.status, newStatus, {
    sriStatus: result.status,
  });

  return formatDocument(updated);
}

async function checkAuthorization(accessKey) {
  const document = await documentModel.findByAccessKey(accessKey);
  if (!document) {
    throw new NotFoundError('Document');
  }
  const checkableStatuses = [DocumentStatus.RECEIVED, DocumentStatus.NOT_AUTHORIZED];
  if (!checkableStatuses.includes(document.status)) {
    throw new AppError(
      `Cannot check authorization for document with status ${document.status}. Must be ${checkableStatuses.join(' or ')}.`,
      400
    );
  }

  const issuer = await issuerModel.findById(document.issuer_id);
  const sriService = require('./sri.service');
  let result;
  try {
    result = await sriService.checkAuthorization(accessKey, issuer.environment);
  } catch (err) {
    await documentEventModel.create(document.id, EventType.ERROR, document.status, null, {
      operation: 'AUTHORIZE',
      message: err.message,
    });
    throw err;
  }

  const sriResponseModel = require('../models/sri-response.model');
  await sriResponseModel.create({
    documentId: document.id,
    operationType: OperationType.AUTHORIZATION,
    status: result.status,
    messages: result.messages,
    rawResponse: result.rawResponse,
  });

  const newStatus = result.status === 'AUTORIZADO' ? DocumentStatus.AUTHORIZED : DocumentStatus.NOT_AUTHORIZED;
  const statusChanged = newStatus !== document.status;

  let updated = document;

  if (statusChanged) {
    const extraFields = {};
    if (result.authorizationNumber) extraFields.authorization_number = result.authorizationNumber;
    if (result.authorizationDate)   extraFields.authorization_date   = result.authorizationDate;
    if (result.authorizationXml)    extraFields.authorization_xml    = result.authorizationXml;

    updated = await documentModel.updateStatus(document.id, newStatus, extraFields);

    await documentEventModel.create(document.id, EventType.STATUS_CHANGED, document.status, newStatus, {
      sriStatus: result.status,
      authorizationNumber: result.authorizationNumber || null,
    });
  }

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
