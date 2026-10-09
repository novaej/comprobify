const rlsContext = require('../config/rls-context');

/**
 * Runs the rest of the request in RLS system context. Only for routes that
 * are cross-tenant by nature and authenticate by other means (admin secret,
 * internal-service secret, webhook signature) — never on a tenant-key route,
 * where `authenticate` sets the tenant context instead.
 */
const systemContext = (_req, _res, next) => rlsContext.runAsSystem(next);

module.exports = systemContext;
