const { Router } = require('express');
const controller = require('../controllers/subscription.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const requireNotSuspended = require('../middleware/require-not-suspended');
const requireNotPastDue = require('../middleware/require-past-due');
const { readLimiter, writeLimiter } = require('../middleware/rate-limit');
const v = require('../validators/subscription.validator');

const router = Router();

router.use(authenticate);

// A SUSPENDED tenant may still view their own subscription/payment history.
router.get('/me', readLimiter, asyncHandler(controller.getMyStatus));
// POST / is deliberately NOT gated by requireNotPastDue (still gated by
// requireNotSuspended) — starting a fresh subscription is the self-service
// recovery path back to ACTIVE for a PAST_DUE tenant. See
// docs/adr/025-past-due-tenant-status.md.
router.post('/', writeLimiter, requireNotSuspended, v.createSubscription, validateRequest, asyncHandler(controller.createSubscription));
router.post('/change-tier', writeLimiter, requireNotSuspended, requireNotPastDue, v.changeTier, validateRequest, asyncHandler(controller.changeTier));
router.delete('/', writeLimiter, requireNotSuspended, requireNotPastDue, asyncHandler(controller.cancelSubscription));

module.exports = router;
