const { Router } = require('express');
const { body } = require('express-validator');
const controller = require('../controllers/tenant.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const requireMatchingEnvironment = require('../middleware/require-matching-environment');
const { writeLimiter, readLimiter } = require('../middleware/rate-limit');
const { SUPPORTED_LANGUAGES } = require('../locales');
const { SUPPORTED_TYPES } = require('../builders');
const TIERS = require('../constants/subscription-tiers');

const PAID_TIERS = Object.keys(TIERS).filter((t) => t !== 'FREE');

const router = Router();

router.use(authenticate);

const updateLanguageValidator = [
  body('language')
    .isIn(SUPPORTED_LANGUAGES)
    .withMessage(`language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`),
];

const promoteValidator = [
  body('initialSequentials')
    .optional()
    .isArray({ min: 1 })
    .withMessage('initialSequentials must be a non-empty array'),
  body('initialSequentials.*.issuerId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('each initialSequentials entry must have a positive integer issuerId'),
  body('initialSequentials.*.documentType')
    .optional()
    .isIn(SUPPORTED_TYPES)
    .withMessage(`each initialSequentials entry documentType must be one of: ${SUPPORTED_TYPES.join(', ')}`),
  body('initialSequentials.*.sequential')
    .optional()
    .isInt({ min: 1 })
    .withMessage('each initialSequentials entry must have a sequential >= 1'),
  body('tier')
    .optional()
    .isIn(PAID_TIERS)
    .withMessage(`tier must be one of: ${PAID_TIERS.join(', ')}`),
  body('billingInterval')
    .optional()
    .isIn(['MONTHLY', 'YEARLY'])
    .withMessage('billingInterval must be one of: MONTHLY, YEARLY'),
];

router.get('/me', readLimiter, requireMatchingEnvironment, asyncHandler(controller.getMe));
router.patch('/language', updateLanguageValidator, validateRequest, asyncHandler(controller.updateLanguage));
router.post('/promote', writeLimiter, promoteValidator, validateRequest, asyncHandler(controller.promote));

module.exports = router;
