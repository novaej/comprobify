const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');
const TenantStatus = require('../constants/tenant-status');

// Blocks a PAST_DUE tenant — mirrors require-not-suspended.js exactly, same
// mount points, but a deliberately separate check: PAST_DUE and SUSPENDED
// are two different responsibilities (see docs/adr/025-past-due-tenant-status.md)
// and must be lifted differently. A PAST_DUE tenant needs a self-service way
// back to ACTIVE, so this middleware is NOT applied to POST /v1/subscriptions
// or PATCH /v1/payments/:id/proof — those two routes stay reachable while
// PAST_DUE (still blocked while SUSPENDED, via requireNotSuspended, which
// every route here also carries).
function requireNotPastDue(req, _res, next) {
  if (req.tenant?.status === TenantStatus.PAST_DUE) {
    return next(new AppError('This account is past due on a subscription renewal. Submit payment or start a new subscription to restore access.', 403, ErrorCodes.ACCOUNT_PAST_DUE));
  }
  next();
}

module.exports = requireNotPastDue;
