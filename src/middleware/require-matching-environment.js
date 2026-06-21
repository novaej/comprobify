const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

/**
 * Rejects requests where the authenticating API key's environment does not
 * match the tenant's current active environment (`tenant.sandbox`).
 *
 * Must run AFTER `authenticate` (depends on req.tenant + req.apiKey).
 */
const requireMatchingEnvironment = (req, _res, next) => {
  const expectedEnv = req.tenant.sandbox ? 'sandbox' : 'production';
  if (req.apiKey.environment !== expectedEnv) {
    return next(new AppError(
      `This API key was created for the ${req.apiKey.environment} environment. ` +
      `The tenant is ${expectedEnv}. Use a key created for the matching environment.`,
      401,
      ErrorCodes.API_KEY_ENV_MISMATCH
    ));
  }
  next();
};

module.exports = requireMatchingEnvironment;
