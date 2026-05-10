const { Router } = require('express');
const controller = require('../controllers/catalog.controller');
const asyncHandler = require('../middleware/async-handler');
const authenticate = require('../middleware/authenticate');
const { readLimiter } = require('../middleware/rate-limit');

const router = Router();

router.use(authenticate);

router.get('/id-types', readLimiter, asyncHandler(controller.listIdTypes));
router.get('/payment-methods', readLimiter, asyncHandler(controller.listPaymentMethods));
router.get('/tax-types', readLimiter, asyncHandler(controller.listTaxTypes));
router.get('/tax-rates', readLimiter, asyncHandler(controller.listTaxRates));

module.exports = router;
