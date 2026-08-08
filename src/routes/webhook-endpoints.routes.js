const { Router } = require('express');
const controller = require('../controllers/webhook-endpoint.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const requireNotSuspended = require('../middleware/require-not-suspended');
const requireNotPastDue = require('../middleware/require-past-due');
const requireScope = require('../middleware/require-scope');
const { ApiKeyScopes } = require('../constants/api-key-scopes');
const { readLimiter, writeLimiter } = require('../middleware/rate-limit');
const v = require('../validators/webhook-endpoint.validator');

const router = Router();

router.use(authenticate);
router.use(requireNotSuspended);
router.use(requireNotPastDue);
// A key that can only read/write documents must not be able to register a
// new webhook endpoint and start receiving the tenant's event fan-out — see
// CLAUDE.md "Tenant-scoped API key permissions."
router.use(requireScope(ApiKeyScopes.ACCOUNT_MANAGE));

// GET  /api/webhooks        — list active endpoints (secrets excluded)
// POST /api/webhooks        — register new endpoint (secret shown once)
// PATCH /api/webhooks/:id   — update url / eventTypes / active
// DELETE /api/webhooks/:id  — deregister (soft-delete)

router.get('/',     readLimiter,  asyncHandler(controller.list));
router.post('/',    writeLimiter, v.createValidator, validateRequest, asyncHandler(controller.create));
router.patch('/:id', writeLimiter, v.updateValidator, validateRequest, asyncHandler(controller.update));
router.delete('/:id', writeLimiter, v.idValidator, validateRequest, asyncHandler(controller.deregister));

module.exports = router;
