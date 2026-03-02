const { Router } = require('express');
const controller = require('../controllers/documents.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const extractIdempotencyKey = require('../middleware/idempotency');
const authenticate = require('../middleware/authenticate');
const { createInvoice } = require('../validators/invoice.validator');
const { accessKeyParam } = require('../validators/common.validator');

const router = Router();

router.use(asyncHandler(authenticate));

router.post('/', extractIdempotencyKey, createInvoice, validateRequest, asyncHandler(controller.create));
router.post('/email-retry', asyncHandler(controller.retryEmails));
router.get('/:accessKey', accessKeyParam, validateRequest, asyncHandler(controller.getByAccessKey));
router.post('/:accessKey/send', accessKeyParam, validateRequest, asyncHandler(controller.sendToSri));
router.get('/:accessKey/authorize', accessKeyParam, validateRequest, asyncHandler(controller.checkAuthorization));
router.post('/:accessKey/rebuild', accessKeyParam, createInvoice, validateRequest, asyncHandler(controller.rebuild));
router.get('/:accessKey/ride', accessKeyParam, validateRequest, asyncHandler(controller.getRide));
router.post('/:accessKey/email-retry', accessKeyParam, validateRequest, asyncHandler(controller.retrySingleEmail));
router.get('/:accessKey/xml', accessKeyParam, validateRequest, asyncHandler(controller.getXml));
router.get('/:accessKey/events', accessKeyParam, validateRequest, asyncHandler(controller.getEvents));

module.exports = router;
