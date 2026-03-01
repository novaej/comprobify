const DocumentStatus = require('./document-status');
const AppError = require('../errors/app-error');

const TRANSITIONS = Object.freeze({
  [DocumentStatus.SIGNED]:         [DocumentStatus.RECEIVED, DocumentStatus.RETURNED],
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
    throw new AppError(`Invalid state transition: ${from} → ${to}`, 400);
  }
}

module.exports = { TRANSITIONS, canTransition, assertTransition };
