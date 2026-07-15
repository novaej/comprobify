const DocumentStatus = require('./document-status');
const AppError = require('../errors/app-error');
const ErrorCodes = require('./error-codes');

const TRANSITIONS = Object.freeze({
  [DocumentStatus.SIGNED]:         [DocumentStatus.PENDING_SEND],
  [DocumentStatus.PENDING_SEND]:   [DocumentStatus.RECEIVED, DocumentStatus.RETURNED],
  [DocumentStatus.RECEIVED]:       [DocumentStatus.AUTHORIZED, DocumentStatus.NOT_AUTHORIZED],
  [DocumentStatus.RETURNED]:       [DocumentStatus.SIGNED],
  [DocumentStatus.NOT_AUTHORIZED]: [DocumentStatus.SIGNED],
  [DocumentStatus.AUTHORIZED]:     [],
});

function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new AppError(`Invalid state transition: ${from} → ${to}`, 400, ErrorCodes.INVALID_STATE_TRANSITION);
  }
}

module.exports = { TRANSITIONS, canTransition, assertTransition };
