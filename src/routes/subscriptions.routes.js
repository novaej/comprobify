const { Router } = require('express');
const controller = require('../controllers/subscription.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const { readLimiter, writeLimiter } = require('../middleware/rate-limit');
const v = require('../validators/subscription.validator');

const router = Router();

router.use(authenticate);

router.get('/me', readLimiter, asyncHandler(controller.getMyStatus));
router.post('/change-tier', writeLimiter, v.changeTier, validateRequest, asyncHandler(controller.changeTier));

module.exports = router;
