const issuerDocumentTypeModel = require('../models/issuer-document-type.model');
const { SUPPORTED_TYPES } = require('../builders');
const AppError = require('../errors/app-error');

async function listDocumentTypes(issuerId) {
  return issuerDocumentTypeModel.findActiveByIssuerId(issuerId);
}

async function addDocumentType(issuerId, documentType) {
  if (!SUPPORTED_TYPES.includes(documentType)) {
    throw new AppError(`Document type '${documentType}' is not supported. Supported types: ${SUPPORTED_TYPES.join(', ')}`, 400);
  }
  await issuerDocumentTypeModel.activate(issuerId, documentType);
  return issuerDocumentTypeModel.findActiveByIssuerId(issuerId);
}

async function removeDocumentType(issuerId, documentType) {
  const active = await issuerDocumentTypeModel.findActiveByIssuerId(issuerId);
  if (!active.includes(documentType)) {
    throw new AppError(`Document type '${documentType}' is not active for this issuer`, 404);
  }
  if (active.length <= 1) {
    throw new AppError('Cannot remove the last document type — at least one must remain active', 400);
  }
  await issuerDocumentTypeModel.deactivate(issuerId, documentType);
  return issuerDocumentTypeModel.findActiveByIssuerId(issuerId);
}

module.exports = { listDocumentTypes, addDocumentType, removeDocumentType };
