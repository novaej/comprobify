const issuerModel = require('../models/issuer.model');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');
const requireMatchingEnvironment = require('./require-matching-environment');

/**
 * Resolves the target issuer for the request from the X-Issuer-Id header.
 *
 * Must run AFTER `authenticate` (depends on req.tenant + req.apiKey).
 *
 * Failure modes:
 *   - Header missing or non-numeric → 400 ISSUER_ID_REQUIRED
 *   - Issuer not found or inactive → 404 ISSUER_NOT_FOUND
 *   - Issuer belongs to a different tenant → 403 ISSUER_FORBIDDEN
 *   - API key environment does not match the issuer's effective environment → 401
 *
 * On success, sets `req.issuer` to the full issuer row.
 */
const resolveIssuer = async (req, _res, next) => {
  const headerValue = req.headers['x-issuer-id'];

  if (!headerValue) {
    return next(new AppError('X-Issuer-Id header is required', 400, ErrorCodes.ISSUER_ID_REQUIRED));
  }

  const issuerId = parseInt(headerValue, 10);
  if (!Number.isInteger(issuerId) || issuerId <= 0 || String(issuerId) !== String(headerValue).trim()) {
    return next(new AppError('X-Issuer-Id must be a positive integer', 400, ErrorCodes.ISSUER_ID_INVALID));
  }

  const issuer = await issuerModel.findById(issuerId);
  if (!issuer) {
    return next(new AppError('Issuer not found', 404, ErrorCodes.ISSUER_NOT_FOUND));
  }

  if (issuer.tenant_id !== req.tenant.id) {
    return next(new AppError('Issuer does not belong to this tenant', 403, ErrorCodes.ISSUER_FORBIDDEN));
  }

  requireMatchingEnvironment(req, _res, (err) => {
    if (err) return next(err);
    // Attach sandbox as a virtual field so downstream services can read issuer.sandbox
    // without needing a separate tenant reference.
    req.issuer = { ...issuer, sandbox: req.tenant.sandbox };
    next();
  });
};

module.exports = resolveIssuer;
