const { Router } = require('express');
const controller = require('../controllers/documents.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const extractIdempotencyKey = require('../middleware/idempotency');
const authenticate = require('../middleware/authenticate');
const requireNotSuspended = require('../middleware/require-not-suspended');
const requireNotPastDue = require('../middleware/require-past-due');
const requireScope = require('../middleware/require-scope');
const { ApiKeyScopes } = require('../constants/api-key-scopes');
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
const readScope = requireScope(ApiKeyScopes.DOCUMENTS_READ);
const writeScope = requireScope(ApiKeyScopes.DOCUMENTS_WRITE);

router.get('/', readLimiter, readScope, listDocumentsQuery, validateRequest, asyncHandler(controller.list));
router.get('/stats', readLimiter, readScope, asyncHandler(controller.getStats));
router.get('/:accessKey', readLimiter, readScope, accessKeyParam, validateRequest, asyncHandler(controller.getByAccessKey));
router.get('/:accessKey/authorize', readLimiter, requireNotSuspended, requireNotPastDue, writeScope, accessKeyParam, validateRequest, asyncHandler(controller.checkAuthorization));
router.get('/:accessKey/ride', readLimiter, readScope, accessKeyParam, validateRequest, asyncHandler(controller.getRide));
router.get('/:accessKey/xml', readLimiter, readScope, accessKeyParam, validateRequest, asyncHandler(controller.getXml));
router.get('/:accessKey/events', readLimiter, readScope, accessKeyParam, validateRequest, asyncHandler(controller.getEvents));
router.get('/:accessKey/credit-notes', readLimiter, readScope, accessKeyParam, validateRequest, asyncHandler(controller.getCreditNotes));
router.get('/:accessKey/sri-responses', readLimiter, readScope, accessKeyParam, validateRequest, asyncHandler(controller.getSriResponses));

// Write endpoints — all blocked while SUSPENDED or PAST_DUE.
router.post('/', writeLimiter, requireNotSuspended, requireNotPastDue, writeScope, extractIdempotencyKey, asyncHandler(selectDocumentValidator), validateRequest, asyncHandler(controller.create));
router.post('/email-retry', writeLimiter, requireNotSuspended, requireNotPastDue, writeScope, asyncHandler(controller.retryEmails));
router.post('/:accessKey/send', writeLimiter, requireNotSuspended, requireNotPastDue, writeScope, accessKeyParam, validateRequest, asyncHandler(controller.sendToSri));
router.post('/:accessKey/send/retry', writeLimiter, requireNotSuspended, requireNotPastDue, writeScope, accessKeyParam, validateRequest, asyncHandler(controller.retrySend));
router.post('/:accessKey/rebuild', writeLimiter, requireNotSuspended, requireNotPastDue, writeScope, accessKeyParam, asyncHandler(selectDocumentValidator), validateRequest, asyncHandler(controller.rebuild));
router.post('/:accessKey/email-retry', writeLimiter, requireNotSuspended, requireNotPastDue, writeScope, accessKeyParam, validateRequest, asyncHandler(controller.retrySingleEmail));

module.exports = router;
