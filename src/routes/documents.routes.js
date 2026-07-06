const { Router } = require('express');
const controller = require('../controllers/documents.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const extractIdempotencyKey = require('../middleware/idempotency');
const authenticate = require('../middleware/authenticate');
const requireNotSuspended = require('../middleware/require-not-suspended');
const resolveIssuer = require('../middleware/resolve-issuer');
const { writeLimiter, readLimiter } = require('../middleware/rate-limit');
const selectDocumentValidator = require('../middleware/select-document-validator');
const { accessKeyParam, listDocumentsQuery } = require('../validators/common.validator');

const router = Router();

router.use(asyncHandler(authenticate));
router.use(asyncHandler(resolveIssuer));

// Read endpoints — a SUSPENDED tenant may still view/download their own
// existing documents (that's not "using the Service," just seeing what's
// already there). GET /:accessKey/authorize is the one exception: it makes a
// live SRI call and can fire the authorization email, so it stays blocked.
router.get('/', readLimiter, listDocumentsQuery, validateRequest, asyncHandler(controller.list));
router.get('/stats', readLimiter, asyncHandler(controller.getStats));
router.get('/:accessKey', readLimiter, accessKeyParam, validateRequest, asyncHandler(controller.getByAccessKey));
router.get('/:accessKey/authorize', readLimiter, requireNotSuspended, accessKeyParam, validateRequest, asyncHandler(controller.checkAuthorization));
router.get('/:accessKey/ride', readLimiter, accessKeyParam, validateRequest, asyncHandler(controller.getRide));
router.get('/:accessKey/xml', readLimiter, accessKeyParam, validateRequest, asyncHandler(controller.getXml));
router.get('/:accessKey/events', readLimiter, accessKeyParam, validateRequest, asyncHandler(controller.getEvents));
router.get('/:accessKey/credit-notes', readLimiter, accessKeyParam, validateRequest, asyncHandler(controller.getCreditNotes));
router.get('/:accessKey/sri-responses', readLimiter, accessKeyParam, validateRequest, asyncHandler(controller.getSriResponses));

// Write endpoints — all blocked while SUSPENDED.
router.post('/', writeLimiter, requireNotSuspended, extractIdempotencyKey, asyncHandler(selectDocumentValidator), validateRequest, asyncHandler(controller.create));
router.post('/email-retry', writeLimiter, requireNotSuspended, asyncHandler(controller.retryEmails));
router.post('/:accessKey/send', writeLimiter, requireNotSuspended, accessKeyParam, validateRequest, asyncHandler(controller.sendToSri));
router.post('/:accessKey/rebuild', writeLimiter, requireNotSuspended, accessKeyParam, asyncHandler(selectDocumentValidator), validateRequest, asyncHandler(controller.rebuild));
router.post('/:accessKey/email-retry', writeLimiter, requireNotSuspended, accessKeyParam, validateRequest, asyncHandler(controller.retrySingleEmail));

module.exports = router;
