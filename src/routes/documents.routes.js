const { Router } = require('express');
const controller = require('../controllers/documents.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const extractIdempotencyKey = require('../middleware/idempotency');
const authenticate = require('../middleware/authenticate');
const resolveIssuer = require('../middleware/resolve-issuer');
const { writeLimiter, readLimiter } = require('../middleware/rate-limit');
const selectDocumentValidator = require('../middleware/select-document-validator');
const { accessKeyParam, listDocumentsQuery } = require('../validators/common.validator');

const router = Router();

router.use(asyncHandler(authenticate));
router.use(asyncHandler(resolveIssuer));

// Read endpoints
router.get('/', readLimiter, listDocumentsQuery, validateRequest, asyncHandler(controller.list));
router.get('/stats', readLimiter, asyncHandler(controller.getStats));
router.get('/:accessKey', readLimiter, accessKeyParam, validateRequest, asyncHandler(controller.getByAccessKey));
router.get('/:accessKey/authorize', readLimiter, accessKeyParam, validateRequest, asyncHandler(controller.checkAuthorization));
router.get('/:accessKey/ride', readLimiter, accessKeyParam, validateRequest, asyncHandler(controller.getRide));
router.get('/:accessKey/xml', readLimiter, accessKeyParam, validateRequest, asyncHandler(controller.getXml));
router.get('/:accessKey/events', readLimiter, accessKeyParam, validateRequest, asyncHandler(controller.getEvents));

// Write endpoints
router.post('/', writeLimiter, extractIdempotencyKey, asyncHandler(selectDocumentValidator), validateRequest, asyncHandler(controller.create));
router.post('/email-retry', writeLimiter, asyncHandler(controller.retryEmails));
router.post('/:accessKey/send', writeLimiter, accessKeyParam, validateRequest, asyncHandler(controller.sendToSri));
router.post('/:accessKey/rebuild', writeLimiter, accessKeyParam, asyncHandler(selectDocumentValidator), validateRequest, asyncHandler(controller.rebuild));
router.post('/:accessKey/email-retry', writeLimiter, accessKeyParam, validateRequest, asyncHandler(controller.retrySingleEmail));

module.exports = router;
