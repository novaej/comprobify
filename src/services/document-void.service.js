const documentModel = require('../models/document.model');
const documentEventModel = require('../models/document-event.model');
const NotFoundError = require('../errors/not-found-error');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');
const DocumentStatus = require('../constants/document-status');
const EventType = require('../constants/event-type');
const { formatDocument } = require('../presenters/document.presenter');

// SRI has no SOAP service to cancel an already-AUTHORIZED document — the
// tenant cancels it on SRI's own portal first, then voids the local record
// here to keep it in sync. There is no way for this API to verify the SRI
// side actually happened, so confirmedSriVoid is a required attestation and
// the reason is kept purely as an audit trail.
async function voidDocument(accessKey, body, issuer) {
  const document = await documentModel.findByAccessKey(accessKey, issuer.id, issuer.sandbox);
  if (!document) {
    throw new NotFoundError('Document');
  }

  if (document.status !== DocumentStatus.AUTHORIZED) {
    throw new AppError(
      'Only an AUTHORIZED document can be voided',
      409,
      ErrorCodes.DOCUMENT_NOT_AUTHORIZED
    );
  }

  if (body.confirmedSriVoid !== true) {
    throw new AppError(
      'confirmedSriVoid must be true — void this document in SRI\'s own portal first',
      400,
      ErrorCodes.DOCUMENT_VOID_CONFIRMATION_REQUIRED
    );
  }

  const updated = await documentModel.updateStatus(document.id, DocumentStatus.VOIDED, {
    void_reason: body.reason,
    voided_at: new Date(),
  }, issuer.id, issuer.sandbox);

  await documentEventModel.create(
    document.id,
    EventType.VOIDED,
    DocumentStatus.AUTHORIZED,
    DocumentStatus.VOIDED,
    { reason: body.reason },
    null,
    issuer.id,
    issuer.sandbox
  );

  return formatDocument(updated);
}

module.exports = { voidDocument };
