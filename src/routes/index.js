const { Router } = require('express');
const router = Router();

router.use('/', require('./registration.routes'));
router.use('/tiers', require('./tiers.routes'));
router.use('/admin', require('./admin.routes'));
router.use('/documents', require('./documents.routes'));
router.use('/issuers', require('./issuers.routes'));
router.use('/keys', require('./api-keys.routes'));
router.use('/catalogs', require('./catalogs.routes'));
router.use('/tenants', require('./tenants.routes'));
router.use('/payments', require('./payments.routes'));
router.use('/subscriptions', require('./subscriptions.routes'));
router.use('/mailgun', require('./mailgun-webhook.routes'));
router.use('/notifications', require('./notifications.routes'));
router.use('/webhooks',      require('./webhook-endpoints.routes'));

module.exports = router;
