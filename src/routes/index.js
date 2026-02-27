const { Router } = require('express');
const router = Router();

router.use('/invoices', require('./invoices.routes'));

module.exports = router;
