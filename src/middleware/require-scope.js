const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');
const attemptTrackerService = require('../services/attempt-tracker.service');
const AttemptEventTypes = require('../constants/attempt-event-types');

// Factory, not a bare middleware — each route family needs a different
// scope, unlike requireNotSuspended/requireNotPastDue. Reads
// req.apiKey.scopes, set by authenticate.js.
function requireScope(scope) {
  return function (req, _res, next) {
    if (!req.apiKey?.scopes?.includes(scope)) {
      // Fire-and-forget — recordEvent never throws, must not add latency
      // here. Repeated misses across different scopes from the same key can
      // indicate a compromised/leaked key being probed for what it can reach.
      if (req.apiKey?.id) {
        attemptTrackerService.recordEvent(AttemptEventTypes.INSUFFICIENT_SCOPE, req.apiKey.id);
      }
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
