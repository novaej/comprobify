const { Router } = require('express');
const controller = require('../controllers/invoices.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const { createInvoice } = require('../validators/invoice.validator');
const { accessKeyParam } = require('../validators/common.validator');

const router = Router();

router.post('/', createInvoice, validateRequest, asyncHandler(controller.create));
router.get('/:accessKey', accessKeyParam, validateRequest, asyncHandler(controller.getByAccessKey));
router.post('/:accessKey/send', accessKeyParam, validateRequest, asyncHandler(controller.sendToSri));
router.get('/:accessKey/authorize', accessKeyParam, validateRequest, asyncHandler(controller.checkAuthorization));
router.post('/:accessKey/rebuild', accessKeyParam, validateRequest, asyncHandler(controller.rebuild));

module.exports = router;
