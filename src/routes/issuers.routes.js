const { Router } = require('express');
const controller = require('../controllers/issuer.controller');
const asyncHandler = require('../middleware/async-handler');
const authenticate = require('../middleware/authenticate');

const router = Router();

router.use(authenticate);

router.post('/promote', asyncHandler(controller.promote));

module.exports = router;
