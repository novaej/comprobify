const { Router } = require('express');
const { body } = require('express-validator');
const controller = require('../controllers/tenant.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const { writeLimiter, readLimiter } = require('../middleware/rate-limit');
const { SUPPORTED_LANGUAGES } = require('../locales');
const { SUPPORTED_TYPES } = require('../builders');

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
];

router.get('/me', readLimiter, asyncHandler(controller.getMe));
router.patch('/language', updateLanguageValidator, validateRequest, asyncHandler(controller.updateLanguage));
router.post('/promote', writeLimiter, promoteValidator, validateRequest, asyncHandler(controller.promote));

module.exports = router;
