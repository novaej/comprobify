const documentModel = require('../models/document.model');
const documentEventModel = require('../models/document-event.model');
const sriService = require('./sri.service');
const sriResponseModel = require('../models/sri-response.model');
const emailService = require('./email.service');
const notificationService = require('./notification.service');
const subscriptionService = require('./subscription.service');
const queueService = require('./queue.service');
const NotFoundError = require('../errors/not-found-error');
const DocumentStatus = require('../constants/document-status');
const EmailStatus = require('../constants/email-status');
const { assertTransition } = require('../constants/document-state-machine');
const EventType = require('../constants/event-type');
const OperationType = require('../constants/operation-type');
const { formatDocument } = require('../presenters/document.presenter');

async function sendToSri(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id, issuer.sandbox);
  if (!document) {
    throw new NotFoundError('Document');
  }
  assertTransition(document.status, DocumentStatus.RECEIVED);

  let result;
  try {
    result = await sriService.sendReceipt(document.signed_xml, issuer);
  } catch (err) {
    await documentEventModel.create(document.id, EventType.ERROR, document.status, null, {
      operation: 'SEND',
      message: err.message,
    }, null, issuer.id, issuer.sandbox);
    throw err;
  }

  await sriResponseModel.create({
    documentId: document.id,
    operationType: OperationType.RECEPTION,
    status: result.status,
    messages: result.messages,
    rawResponse: result.rawResponse,
    sandbox: issuer.sandbox,
  });

  const isProcessing = result.messages.some(m => m.identifier === '70');
  const newStatus = (result.status === 'RECIBIDA' || isProcessing)
    ? DocumentStatus.RECEIVED
    : DocumentStatus.RETURNED;
  const updated = await documentModel.updateStatus(document.id, newStatus, {}, issuer.id, issuer.sandbox);

  await documentEventModel.create(document.id, EventType.SENT, document.status, newStatus, {
    sriStatus: result.status,
    ...(isProcessing && { processingRetry: true, sriIdentifier: '70' }),
  }, null, issuer.id, issuer.sandbox);

  return {
    ...formatDocument(updated),
    sriStatus: result.status,
    ...(isProcessing && { processingRetry: true }),
    sriMessages: result.messages,
  };
}

async function checkAuthorization(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id, issuer.sandbox);
  if (!document) {
    throw new NotFoundError('Document');
  }
  assertTransition(document.status, DocumentStatus.AUTHORIZED);

  let result;
  try {
    result = await sriService.checkAuthorization(accessKey, issuer);
  } catch (err) {
    await documentEventModel.create(document.id, EventType.ERROR, document.status, null, {
      operation: 'AUTHORIZE',
      message: err.message,
    }, null, issuer.id, issuer.sandbox);
    throw err;
  }

  await sriResponseModel.create({
    documentId: document.id,
    operationType: OperationType.AUTHORIZATION,
    status: result.status,
    messages: result.messages,
    rawResponse: result.rawResponse,
    sandbox: issuer.sandbox,
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

    updated = await documentModel.updateStatus(document.id, newStatus, extraFields, issuer.id, issuer.sandbox);

    await documentEventModel.create(document.id, EventType.STATUS_CHANGED, document.status, newStatus, {
      sriStatus: result.status,
      authorizationNumber: result.authorizationNumber || null,
    }, null, issuer.id, issuer.sandbox);

    if (newStatus === DocumentStatus.AUTHORIZED) {
      // Fire-and-forget: create a DOCUMENT_AUTHORIZED notification for the tenant.
      notificationService.createDocumentAuthorized(updated, issuer)
        .catch(err => console.warn('Notification creation failed:', err.message));

      // Fire-and-forget: activate a subscription if this document is its linked
      // self-billed invoice. No-op for the vast majority of documents, which
      // aren't linked to any subscription.
      subscriptionService.activateIfLinked(updated.id)
        .catch(err => console.warn('Subscription activation check failed:', err.message));

      // Fire-and-forget: apply a pending tier-change upgrade if this document
      // is its linked self-billed invoice. No-op for the vast majority of
      // documents, which aren't linked to any tier-change payment.
      subscriptionService.applyTierChangeIfLinked(updated.id)
        .catch(err => console.warn('Tier change check failed:', err.message));

      // Fire-and-forget: extend the billing period if this document is the
      // linked self-billed invoice for a renewal payment. No-op for the vast
      // majority of documents, which aren't linked to any renewal payment.
      subscriptionService.applyRenewalIfLinked(updated.id)
        .catch(err => console.warn('Subscription renewal check failed:', err.message));

      emailService.sendInvoiceAuthorized(updated)
        .then(({ sent, messageId }) => {
          const emailFields = sent
            ? { email_status: EmailStatus.SENT, email_sent_at: new Date(), email_message_id: messageId }
            : { email_status: EmailStatus.SKIPPED };
          return Promise.all([
            documentModel.updateStatus(updated.id, updated.status, emailFields, updated.issuer_id, issuer.sandbox),
            documentEventModel.create(updated.id,
              sent ? EventType.EMAIL_SENT : EventType.EMAIL_SKIPPED,
              null, null, { to: updated.buyer_email }, null, updated.issuer_id, issuer.sandbox),
          ]);
        })
        .catch(err => {
          console.warn('Invoice email failed:', err.message);
          return Promise.all([
            documentModel.updateStatus(updated.id, updated.status, {
              email_status: EmailStatus.FAILED,
              email_error: err.message,
            }, updated.issuer_id, issuer.sandbox),
            documentEventModel.create(updated.id, EventType.EMAIL_FAILED,
              null, null, { error: err.message }, null, updated.issuer_id, issuer.sandbox),
          ]).catch(() => {});
        });
    }
  }

  return formatDocument(updated);
}

// Queues a document for async SRI submission (NEXT_STEPS.md item 2). Moves
// the document to PENDING_SEND — durably, in Postgres, regardless of publish
// outcome — then attempts a broker-confirmed publish. The worker
// (workers/sri-worker.js) is the only code that calls sendToSri() itself; if
// the publish here fails or times out, the document simply stays
// PENDING_SEND with no confirmed dispatch, and
// queue-reconciliation.service.js will notice and re-publish. A publish
// failure never fails this request — that's the whole point of using
// Postgres as the source of truth instead of the broker.
async function queueSend(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id, issuer.sandbox);
  if (!document) {
    throw new NotFoundError('Document');
  }
  assertTransition(document.status, DocumentStatus.PENDING_SEND);

  const updated = await documentModel.updateStatus(document.id, DocumentStatus.PENDING_SEND, {}, issuer.id, issuer.sandbox);
  await documentEventModel.create(document.id, EventType.STATUS_CHANGED, document.status, DocumentStatus.PENDING_SEND, {}, null, issuer.id, issuer.sandbox);

  try {
    await queueService.publishConfirmed(queueService.ROUTING_KEYS.send, {
      documentId: updated.id,
      accessKey: updated.access_key,
      issuerId: issuer.id,
      sandbox: issuer.sandbox,
    });
    await documentModel.updateStatus(updated.id, updated.status, { send_dispatch_attempted_at: new Date() }, issuer.id, issuer.sandbox);
  } catch (err) {
    console.warn('SRI send publish failed, will be picked up by reconciliation:', err.message);
  }

  return formatDocument(updated);
}

// Queues an authorization check (NEXT_STEPS.md item 2). Unlike queueSend,
// this doesn't transition status itself — RECEIVED already means "awaiting
// authorization"; only checkAuthorization() (called by the worker) decides
// the actual outcome. If the publish fails, queue-reconciliation.service.js's
// periodic sweep of RECEIVED documents will publish one later regardless of
// whether a client ever calls this endpoint.
async function queueAuthorizationCheck(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id, issuer.sandbox);
  if (!document) {
    throw new NotFoundError('Document');
  }
  assertTransition(document.status, DocumentStatus.AUTHORIZED);

  try {
    await queueService.publishConfirmed(queueService.ROUTING_KEYS.authorize, {
      documentId: document.id,
      accessKey: document.access_key,
      issuerId: issuer.id,
      sandbox: issuer.sandbox,
    });
    await documentModel.updateStatus(document.id, document.status, { authorize_dispatch_attempted_at: new Date() }, issuer.id, issuer.sandbox);
  } catch (err) {
    console.warn('SRI authorize-check publish failed, will be picked up by reconciliation:', err.message);
  }

  return formatDocument(document);
}

module.exports = { sendToSri, checkAuthorization, queueSend, queueAuthorizationCheck };
