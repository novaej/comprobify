const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');
const TenantStatus = require('../constants/tenant-status');

// Blocks a SUSPENDED tenant. Split out of authenticate.js so specific
// read-only routes (their own existing documents, subscription/payment
// history, account status) can stay reachable while every write — and any
// other read — stays blocked. Applied per-route, not blanket, on any router
// that has such an exception; applied via router.use() immediately after
// authenticate on routers that don't. See CLAUDE.md "Tenant model."
function requireNotSuspended(req, _res, next) {
  if (req.tenant?.status === TenantStatus.SUSPENDED) {
    return next(new AppError('This account has been suspended. Contact support.', 403, ErrorCodes.ACCOUNT_SUSPENDED));
  }
  next();
}

module.exports = requireNotSuspended;
