const crypto = require('crypto');
const legalDocumentModel = require('../models/legal-document.model');
const NotFoundError = require('../errors/not-found-error');
const ErrorCodes = require('../constants/error-codes');

const DOCUMENT_TYPES = ['TERMS', 'PRIVACY', 'DPA'];

async function publish(documentType, version, buffer, contentType) {
  return legalDocumentModel.create({ documentType, version, content: buffer, contentType });
}

async function getCurrent(documentType) {
  const doc = await legalDocumentModel.findCurrentByType(documentType);
  if (!doc) throw new NotFoundError('Legal document', ErrorCodes.LEGAL_DOCUMENT_NOT_FOUND);
  return doc;
}

async function listCurrent() {
  return legalDocumentModel.findAllCurrent();
}

// The "bundle version" a Client must accept is whichever of TERMS/PRIVACY/DPA was
// published most recently — not just TERMS — so that publishing an updated DPA
// alone (without touching ToS/Privacy text) still forces re-acceptance instead of
// going unnoticed ("DPA silencioso"). hash is a tamper-evident fingerprint of
// exactly which published row of each type was current at this moment, kept
// alongside the version string as a stronger audit trail than the string alone.
async function getCurrentSnapshot() {
  const documents = await listCurrent();
  if (documents.length === 0) return { version: null, hash: null };

  const newest = documents.reduce((a, b) => (new Date(b.created_at) > new Date(a.created_at) ? b : a));
  const fingerprint = documents
    .map((d) => ({ documentType: d.document_type, id: d.id, version: d.version }))
    .sort((a, b) => a.documentType.localeCompare(b.documentType));
  const hash = crypto.createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');

  return { version: newest.version, hash };
}

module.exports = { DOCUMENT_TYPES, publish, getCurrent, listCurrent, getCurrentSnapshot };
