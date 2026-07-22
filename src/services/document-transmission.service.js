const documentModel = require('../models/document.model');
const documentEventModel = require('../models/document-event.model');
const sriService = require('./sri.service');
const sriResponseModel = require('../models/sri-response.model');
const pendingEffectService = require('./pending-effect.service');
const { EffectTypes } = require('../constants/effect-types');
const NotFoundError = require('../errors/not-found-error');
const DocumentStatus = require('../constants/document-status');
const { assertTransition } = require('../constants/document-state-machine');
const EventType = require('../constants/event-type');
const OperationType = require('../constants/operation-type');
const { formatDocument } = require('../presenters/document.presenter');

function authorizeDedupKey(documentId) {
  return `sri-authorize:${documentId}`;
}

// Durable-enqueue + best-effort-dispatch, mirrored at every producer call
// site in this file (see ADR-022 / pending-effect.service.js).
async function queueEffect(effectType, payload, dedupKey = null) {
  const effect = await pendingEffectService.enqueue(effectType, payload, dedupKey);
  pendingEffectService.dispatch(effect);
  return effect;
}

// Called by the SRI_SEND effect handler (src/effects/index.js) — the only
// caller of this function since Phase 2 (previously workers/sri-worker.js
// called it directly).
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

  if (newStatus === DocumentStatus.RECEIVED) {
    // Guarantees every RECEIVED document eventually gets an authorize-check
    // even if the client never calls GET /:key/authorize — not dispatched
    // yet (no dispatch() call here); reconciliation's authorizeCheckDelayMinutes
    // window covers the "SRI needs processing time first" delay. If the
    // client does call GET /:key/authorize before then, queueAuthorizationCheck
    // finds this same row via dedup_key and dispatches it immediately instead.
    await pendingEffectService.enqueue(EffectTypes.SRI_AUTHORIZE, {
      documentId: updated.id,
      accessKey: updated.access_key,
      issuerId: issuer.id,
      sandbox: issuer.sandbox,
    }, authorizeDedupKey(updated.id));
  }

  return {
    ...formatDocument(updated),
    sriStatus: result.status,
    ...(isProcessing && { processingRetry: true }),
    sriMessages: result.messages,
  };
}

// Called by the SRI_AUTHORIZE effect handler (src/effects/index.js) — the
// only caller since Phase 2. Returns { requeue: true } instead of the
// document when SRI reports "still processing" — the effect processor
// leaves the pending_effects row as-is (not DONE) so reconciliation
// re-dispatches it later, rather than treating "nothing changed yet" as
// either success or failure. See ADR-022.
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
    return { requeue: true };
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
      const payload = {
        documentId: updated.id,
        accessKey: updated.access_key,
        issuerId: issuer.id,
        sandbox: issuer.sandbox,
      };
      // Durable-enqueue every post-authorization side effect (awaited — the
      // INSERT must land before this function returns, or a crash right
      // after could lose the effect entirely, same failure mode Phase 2
      // exists to close), then best-effort dispatch each (queueEffect
      // itself doesn't await dispatch). Replaces the old unawaited
      // .catch(console.warn) fire-and-forget calls (ADR-022, NEXT_STEPS.md
      // item 2 Phase 2).
      await Promise.all([
        queueEffect(EffectTypes.DOCUMENT_AUTHORIZED_NOTIFICATION, payload),
        queueEffect(EffectTypes.SUBSCRIPTION_ACTIVATE_IF_LINKED, payload),
        queueEffect(EffectTypes.SUBSCRIPTION_APPLY_TIER_CHANGE_IF_LINKED, payload),
        queueEffect(EffectTypes.SUBSCRIPTION_APPLY_RENEWAL_IF_LINKED, payload),
        queueEffect(EffectTypes.INVOICE_AUTHORIZED_EMAIL, payload),
      ]);
    }
  }

  return formatDocument(updated);
}

// Queues a document for async SRI submission (see ADR-019/ADR-022). Moves
// the document to PENDING_SEND — durably, in Postgres, regardless of publish
// outcome — then enqueues + best-effort-dispatches an SRI_SEND effect. The
// SRI_SEND handler (src/effects/index.js) is the only code that calls
// sendToSri(); if the dispatch here fails or times out, the document simply
// stays PENDING_SEND with an undispatched pending_effects row, and
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

  await queueEffect(EffectTypes.SRI_SEND, {
    documentId: updated.id,
    accessKey: updated.access_key,
    issuerId: issuer.id,
    sandbox: issuer.sandbox,
  });

  return formatDocument(updated);
}

// Queues an authorization check (see ADR-019/ADR-022). Unlike queueSend,
// this doesn't transition status itself — RECEIVED already means "awaiting
// authorization"; only checkAuthorization() (called by the SRI_AUTHORIZE
// effect handler) decides the actual outcome. Finds-or-creates the
// SRI_AUTHORIZE row via dedup_key — sendToSri already creates one (undispatched)
// the moment the document becomes RECEIVED, so this normally just dispatches
// that existing row immediately (the client explicitly asked, so skip the
// reconciliation delay); creating one here too is a defensive fallback for
// data that predates this row's proactive creation. If the publish fails,
// queue-reconciliation.service.js's sweep will publish one later regardless
// of whether a client ever calls this endpoint.
async function queueAuthorizationCheck(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id, issuer.sandbox);
  if (!document) {
    throw new NotFoundError('Document');
  }
  assertTransition(document.status, DocumentStatus.AUTHORIZED);

  await queueEffect(EffectTypes.SRI_AUTHORIZE, {
    documentId: document.id,
    accessKey: document.access_key,
    issuerId: issuer.id,
    sandbox: issuer.sandbox,
  }, authorizeDedupKey(document.id));

  return formatDocument(document);
}

module.exports = { sendToSri, checkAuthorization, queueSend, queueAuthorizationCheck };
