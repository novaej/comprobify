const { Router } = require('express');
const router = Router();

router.use('/admin', require('./admin.routes'));
router.use('/documents', require('./documents.routes'));

module.exports = router;
