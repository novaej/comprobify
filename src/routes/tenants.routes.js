const { Router } = require('express');
const { body } = require('express-validator');
const controller = require('../controllers/tenant.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const { SUPPORTED_LANGUAGES } = require('../locales');

const router = Router();

router.use(authenticate);

const updateLanguageValidator = [
  body('language')
    .isIn(SUPPORTED_LANGUAGES)
    .withMessage(`language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`),
];

router.patch('/language', updateLanguageValidator, validateRequest, asyncHandler(controller.updateLanguage));

module.exports = router;
