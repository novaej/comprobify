const crypto = require('crypto');

// Mounted first, ahead of everything else — every request gets a correlation
// id regardless of whether it ever authenticates. Returned via X-Request-Id so
// a client can report it back when filing a support ticket.
function requestId(req, res, next) {
  req.requestId = crypto.randomUUID();
  res.set('X-Request-Id', req.requestId);
  next();
}

module.exports = requestId;
