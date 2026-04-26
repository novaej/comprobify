const { Router } = require('express');
const router = Router();

router.use('/', require('./registration.routes'));
router.use('/admin', require('./admin.routes'));
router.use('/documents', require('./documents.routes'));
router.use('/issuers', require('./issuers.routes'));
router.use('/mailgun', require('./mailgun-webhook.routes'));

module.exports = router;
