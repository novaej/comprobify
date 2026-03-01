const { Router } = require('express');
const router = Router();

router.use('/documents', require('./documents.routes'));

module.exports = router;
