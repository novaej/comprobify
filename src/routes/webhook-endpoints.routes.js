const { Router } = require('express');
const controller = require('../controllers/webhook-endpoint.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const requireNotSuspended = require('../middleware/require-not-suspended');
const { readLimiter, writeLimiter } = require('../middleware/rate-limit');
const v = require('../validators/webhook-endpoint.validator');

const router = Router();

router.use(authenticate);
router.use(requireNotSuspended);

// GET  /api/webhooks        — list active endpoints (secrets excluded)
// POST /api/webhooks        — register new endpoint (secret shown once)
// PATCH /api/webhooks/:id   — update url / eventTypes / active
// DELETE /api/webhooks/:id  — deregister (soft-delete)

router.get('/',     readLimiter,  asyncHandler(controller.list));
router.post('/',    writeLimiter, v.createValidator, validateRequest, asyncHandler(controller.create));
router.patch('/:id', writeLimiter, v.updateValidator, validateRequest, asyncHandler(controller.update));
router.delete('/:id', writeLimiter, v.idValidator, validateRequest, asyncHandler(controller.deregister));

module.exports = router;
