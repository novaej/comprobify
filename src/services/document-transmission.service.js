const documentModel = require('../models/document.model');
const documentEventModel = require('../models/document-event.model');
const sriService = require('./sri.service');
const sriResponseModel = require('../models/sri-response.model');
const emailService = require('./email.service');
const NotFoundError = require('../errors/not-found-error');
const DocumentStatus = require('../constants/document-status');
const { assertTransition } = require('../constants/document-state-machine');
const EventType = require('../constants/event-type');
const OperationType = require('../constants/operation-type');
const { formatDocument } = require('../presenters/document.presenter');

async function sendToSri(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id);
  if (!document) {
    throw new NotFoundError('Document');
  }
  assertTransition(document.status, DocumentStatus.RECEIVED);

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

async function checkAuthorization(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id);
  if (!document) {
    throw new NotFoundError('Document');
  }
  assertTransition(document.status, DocumentStatus.AUTHORIZED);

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

  await sriResponseModel.create({
    documentId: document.id,
    operationType: OperationType.AUTHORIZATION,
    status: result.status,
    messages: result.messages,
    rawResponse: result.rawResponse,
  });

  if (result.pending) {
    return formatDocument(document);
  }

  const newStatus = result.status === 'AUTORIZADO' ? DocumentStatus.AUTHORIZED : DocumentStatus.NOT_AUTHORIZED;
  const statusChanged = newStatus !== document.status;

  let updated = document;

  if (statusChanged) {
    const extraFields = {};
    if (newStatus === DocumentStatus.AUTHORIZED) {
      if (result.authorizationNumber) extraFields.authorization_number = result.authorizationNumber;
      if (result.authorizationDate)   extraFields.authorization_date   = result.authorizationDate;
      if (result.authorizationXml)    extraFields.authorization_xml    = result.authorizationXml;
    }

    updated = await documentModel.updateStatus(document.id, newStatus, extraFields);

    await documentEventModel.create(document.id, EventType.STATUS_CHANGED, document.status, newStatus, {
      sriStatus: result.status,
      authorizationNumber: result.authorizationNumber || null,
    });

    if (newStatus === DocumentStatus.AUTHORIZED) {
      emailService.sendInvoiceAuthorized(updated)
        .then(({ sent }) => {
          const emailFields = sent
            ? { email_status: 'SENT', email_sent_at: new Date() }
            : { email_status: 'SKIPPED' };
          return Promise.all([
            documentModel.updateStatus(updated.id, updated.status, emailFields),
            documentEventModel.create(updated.id,
              sent ? EventType.EMAIL_SENT : EventType.EMAIL_FAILED,
              null, null, { to: updated.buyer_email }),
          ]);
        })
        .catch(err => {
          console.warn('Invoice email failed:', err.message);
          Promise.all([
            documentModel.updateStatus(updated.id, updated.status, {
              email_status: 'FAILED',
              email_error: err.message,
            }),
            documentEventModel.create(updated.id, EventType.EMAIL_FAILED,
              null, null, { error: err.message }),
          ]).catch(() => {});
        });
    }
  }

  return formatDocument(updated);
}

module.exports = { sendToSri, checkAuthorization };
