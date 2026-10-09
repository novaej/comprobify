const { Router } = require('express');
const asyncHandler = require('../middleware/async-handler');
const verifyMailgunWebhook = require('../middleware/verify-mailgun-webhook');
const systemContext = require('../middleware/system-context');
const mailgunWebhookController = require('../controllers/mailgun-webhook.controller');

const router = Router();

router.post('/webhook', verifyMailgunWebhook, systemContext, asyncHandler(mailgunWebhookController.handle));

module.exports = router;
