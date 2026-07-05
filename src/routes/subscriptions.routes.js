const { Router } = require('express');
const controller = require('../controllers/subscription.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const requireNotSuspended = require('../middleware/require-not-suspended');
const { readLimiter, writeLimiter } = require('../middleware/rate-limit');
const v = require('../validators/subscription.validator');

const router = Router();

router.use(authenticate);

// A SUSPENDED tenant may still view their own subscription/payment history.
router.get('/me', readLimiter, asyncHandler(controller.getMyStatus));
router.post('/', writeLimiter, requireNotSuspended, v.createSubscription, validateRequest, asyncHandler(controller.createSubscription));
router.post('/change-tier', writeLimiter, requireNotSuspended, v.changeTier, validateRequest, asyncHandler(controller.changeTier));
router.delete('/', writeLimiter, requireNotSuspended, asyncHandler(controller.cancelSubscription));

module.exports = router;
