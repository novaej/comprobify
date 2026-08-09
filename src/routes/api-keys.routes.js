const { Router } = require('express');
const { body, param, query } = require('express-validator');
const controller = require('../controllers/api-key.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const requireNotSuspended = require('../middleware/require-not-suspended');
const requireNotPastDue = require('../middleware/require-past-due');
const requireScope = require('../middleware/require-scope');
const { ApiKeyScopes, ALL_SCOPES } = require('../constants/api-key-scopes');
const { writeLimiter, readLimiter } = require('../middleware/rate-limit');

const router = Router();

router.use(authenticate);
router.use(requireNotSuspended);
router.use(requireNotPastDue);
// Key management is its own scope — otherwise a scoped-down key could mint
// itself a broader one. requireScope only proves the caller can touch keys
// at all; api-key.service.js's createKey() separately enforces that a new
// key's scopes can never exceed the requesting key's own (privilege
// containment) — see CLAUDE.md "Tenant-scoped API key permissions."
router.use(requireScope(ApiKeyScopes.KEYS_MANAGE));

const createValidator = [
  body('label')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('label must be a string of max 100 characters'),

  body('environment')
    .optional()
    .isIn(['sandbox', 'production'])
    .withMessage(`environment must be 'sandbox' or 'production'`),

  body('scopes')
    .optional()
    .isArray({ min: 1 })
    .withMessage('scopes must be a non-empty array when provided'),
  body('scopes.*')
    .isIn(ALL_SCOPES)
    .withMessage(`each scope must be one of: ${ALL_SCOPES.join(', ')}`),
];

const idParam = [
  param('id').isUUID().withMessage('id must be a valid UUID'),
];

const usageValidator = [
  ...idParam,
  query('days')
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('days must be between 1 and 365'),
];

router.get('/', readLimiter, asyncHandler(controller.list));
router.post('/', writeLimiter, createValidator, validateRequest, asyncHandler(controller.create));
router.delete('/:id', writeLimiter, idParam, validateRequest, asyncHandler(controller.revoke));
router.get('/:id/usage', readLimiter, usageValidator, validateRequest, asyncHandler(controller.usage));

module.exports = router;
