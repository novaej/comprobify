const moment = require('moment');
const documentModel = require('../models/document.model');
const documentEventModel = require('../models/document-event.model');
const sriResponseModel = require('../models/sri-response.model');
const catalogModel = require('../models/catalog.model');
const pendingEffectModel = require('../models/pending-effect.model');
const NotFoundError = require('../errors/not-found-error');
const DocumentStatus = require('../constants/document-status');
const { EffectTypes } = require('../constants/effect-types');
const { formatDocument } = require('../presenters/document.presenter');

// Maps a document's current status to the effect type actively driving its
// next transition — PENDING_SEND is waiting on SRI_SEND, RECEIVED is waiting
// on SRI_AUTHORIZE. Any other status (SIGNED, AUTHORIZED, RETURNED,
// NOT_AUTHORIZED) has nothing in flight.
function relevantEffectTypeFor(documentStatus) {
  if (documentStatus === DocumentStatus.PENDING_SEND) return EffectTypes.SRI_SEND;
  if (documentStatus === DocumentStatus.RECEIVED) return EffectTypes.SRI_AUTHORIZE;
  return null;
}

async function getByAccessKey(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id, issuer.sandbox);
  if (!document) return null;

  const formatted = formatDocument(document);

  // Lets a polling client (GET /:accessKey every few seconds while waiting
  // on SRI) tell "still auto-retrying" apart from "exhausted all 5 attempts,
  // needs a manual POST /:accessKey/send/retry" instead of guessing from how
  // long it's been polling — the two timescales don't match (reconciliation
  // spaces automatic re-attempts 5 minutes apart, so exhausting all 5 can
  // take ~20+ minutes, far longer than a typical short polling window).
  const relevantEffectType = relevantEffectTypeFor(document.status);
  if (relevantEffectType) {
    const effect = await pendingEffectModel.findActiveByDocumentId(document.id, issuer.tenant_id, relevantEffectType);
    if (effect) {
      formatted.dispatch = {
        status: effect.status,
        attemptCount: effect.attempt_count,
        lastError: effect.last_error,
      };
    }
  }

  return formatted;
}

async function getCreditNotes(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id, issuer.sandbox);
  if (!document) {
    throw new NotFoundError('Document');
  }

  // Reconstruct this document's own NNN-NNN-NNNNNNNNN number — credit notes store the
  // document they reference this way (request_payload.originalDocument.number), not by id.
  const originalNumber = `${issuer.branch_code}-${issuer.issue_point_code}-${String(document.sequential).padStart(9, '0')}`;

  const creditNotes = await documentModel.findCreditNotesByOriginalDocument(
    issuer.id, document.document_type, originalNumber, issuer.sandbox
  );

  const creditedTotal = creditNotes.reduce((sum, cn) => sum + parseFloat(cn.total), 0);
  const remaining = parseFloat(document.total) - creditedTotal;

  return {
    originalDocument: { accessKey: document.access_key, total: document.total },
    creditedTotal: creditedTotal.toFixed(2),
    remaining: remaining.toFixed(2),
    creditNotes: creditNotes.map((cn) => ({
      accessKey: cn.access_key,
      sequential: String(cn.sequential).padStart(9, '0'),
      total: cn.total,
      issueDate: moment(cn.issue_date).format('DD/MM/YYYY'),
    })),
  };
}

async function getXml(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id, issuer.sandbox);
  if (!document) {
    throw new NotFoundError('Document');
  }
  const xml = document.authorization_xml || document.signed_xml;
  return { xml, contentType: 'application/xml' };
}

async function getEvents(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id, issuer.sandbox);
  if (!document) {
    throw new NotFoundError('Document');
  }
  const rows = await documentEventModel.findByDocumentId(document.id, issuer.id, issuer.sandbox);
  return rows.map(e => ({
    id: e.id,
    eventType: e.event_type,
    fromStatus: e.from_status,
    toStatus: e.to_status,
    detail: e.detail,
    createdAt: e.created_at,
  }));
}

async function getSriResponses(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id, issuer.sandbox);
  if (!document) {
    throw new NotFoundError('Document');
  }
  const rows = await sriResponseModel.findByDocumentId(document.id, issuer.sandbox);
  return rows.map(r => ({
    operationType: r.operation_type,
    status: r.status,
    messages: r.messages,
    createdAt: r.created_at,
  }));
}

async function list(issuer, filters = {}) {
  // The API contract takes from/to as DD/MM/YYYY (validated by listDocumentsQuery), but
  // issue_date is a DATE column — convert to an unambiguous ISO date before it reaches the model.
  const parsedFilters = { ...filters };
  if (filters.from) parsedFilters.from = moment(filters.from, 'DD/MM/YYYY').format('YYYY-MM-DD');
  if (filters.to) parsedFilters.to = moment(filters.to, 'DD/MM/YYYY').format('YYYY-MM-DD');

  const { documents, pagination } = await documentModel.findByIssuerId(issuer.id, parsedFilters, issuer.sandbox);
  const formattedDocuments = documents.map(formatDocument);
  return { data: formattedDocuments, pagination };
}

async function getStats(issuer) {
  const { byType, needsAttention } = await documentModel.getStats(issuer.id, issuer.sandbox);

  const formattedByType = await Promise.all(byType.map(async (row) => ({
    type: await catalogModel.getDocumentTypeLabel(row.document_type),
    issued: parseInt(row.issued, 10),
    authorizedTotal: Number(row.authorized_total).toFixed(2),
  })));

  return { thisMonth: { byType: formattedByType }, needsAttention };
}

module.exports = { getByAccessKey, getCreditNotes, getXml, getEvents, getSriResponses, list, getStats };
