const { Router } = require('express');
const controller = require('../controllers/health.controller');

const router = Router();

router.get('/', controller.check);

module.exports = router;
