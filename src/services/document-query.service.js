const documentModel = require('../models/document.model');
const documentEventModel = require('../models/document-event.model');
const NotFoundError = require('../errors/not-found-error');
const { formatDocument } = require('../presenters/document.presenter');

async function getByAccessKey(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id);
  if (!document) return null;
  return formatDocument(document);
}

async function getXml(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id);
  if (!document) {
    throw new NotFoundError('Document');
  }
  const xml = document.authorization_xml || document.signed_xml;
  return { xml, contentType: 'application/xml' };
}

async function getEvents(accessKey, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id);
  if (!document) {
    throw new NotFoundError('Document');
  }
  const rows = await documentEventModel.findByDocumentId(document.id, issuer.id);
  return rows.map(e => ({
    id: e.id,
    eventType: e.event_type,
    fromStatus: e.from_status,
    toStatus: e.to_status,
    detail: e.detail,
    createdAt: e.created_at,
  }));
}

async function list(issuer, filters = {}) {
  const { documents, pagination } = await documentModel.findByIssuerId(issuer.id, filters);
  const formattedDocuments = documents.map(formatDocument);
  return { data: formattedDocuments, pagination };
}

module.exports = { getByAccessKey, getXml, getEvents, list };
