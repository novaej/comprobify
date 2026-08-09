const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

// Factory, not a bare middleware — each route family needs a different
// scope, unlike requireNotSuspended/requireNotPastDue. Reads
// req.apiKey.scopes, set by authenticate.js.
function requireScope(scope) {
  return function (req, _res, next) {
    if (!req.apiKey?.scopes?.includes(scope)) {
      return next(new AppError(
        `This API key does not have the '${scope}' scope`,
        403,
        ErrorCodes.INSUFFICIENT_SCOPE
      ));
    }
    next();
  };
}

module.exports = requireScope;
