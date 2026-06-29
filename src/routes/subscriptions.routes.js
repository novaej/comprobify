const { Router } = require('express');
const controller = require('../controllers/subscription.controller');
const asyncHandler = require('../middleware/async-handler');
const authenticate = require('../middleware/authenticate');
const { readLimiter } = require('../middleware/rate-limit');

const router = Router();

router.use(authenticate);

router.get('/me', readLimiter, asyncHandler(controller.getMyStatus));

module.exports = router;
