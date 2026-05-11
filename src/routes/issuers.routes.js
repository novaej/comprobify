const { Router } = require('express');
const { body, param } = require('express-validator');
const multer = require('multer');
const controller = require('../controllers/issuer.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const { writeLimiter, readLimiter } = require('../middleware/rate-limit');
const { SUPPORTED_TYPES } = require('../builders');
const v = require('../validators/issuer.validator');

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

router.use(authenticate);

const promoteValidator = [
  body('initialSequentials')
    .optional()
    .isArray({ min: 1 })
    .withMessage('initialSequentials must be a non-empty array'),
  body('initialSequentials.*.documentType')
    .optional()
    .isIn(SUPPORTED_TYPES)
    .withMessage(`each documentType must be one of: ${SUPPORTED_TYPES.join(', ')}`),
  body('initialSequentials.*.sequential')
    .optional()
    .isInt({ min: 1 })
    .withMessage('each sequential must be an integer >= 1'),
];

const addDocumentTypeValidator = [
  body('documentType')
    .isIn(SUPPORTED_TYPES)
    .withMessage(`documentType must be one of: ${SUPPORTED_TYPES.join(', ')}`),
];

const removeDocumentTypeValidator = [
  param('code')
    .isIn(SUPPORTED_TYPES)
    .withMessage(`code must be one of: ${SUPPORTED_TYPES.join(', ')}`),
];

router.post('/', writeLimiter, upload.single('cert'), v.createBranch, validateRequest, asyncHandler(controller.createBranch));
router.get('/', readLimiter, asyncHandler(controller.list));
router.get('/me', readLimiter, asyncHandler(controller.me));
router.post('/promote', promoteValidator, validateRequest, asyncHandler(controller.promote));
router.get('/document-types', asyncHandler(controller.listDocumentTypes));
router.post('/document-types', addDocumentTypeValidator, validateRequest, asyncHandler(controller.addDocumentType));
router.delete('/document-types/:code', removeDocumentTypeValidator, validateRequest, asyncHandler(controller.removeDocumentType));

module.exports = router;
