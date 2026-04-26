const { Router } = require('express');
const multer = require('multer');
const controller = require('../controllers/registration.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const { register, verifyEmail } = require('../validators/registration.validator');
const { registrationLimiter } = require('../middleware/rate-limit');

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/register', registrationLimiter, upload.single('cert'), register, validateRequest, asyncHandler(controller.register));
router.get('/verify-email', verifyEmail, validateRequest, asyncHandler(controller.verifyEmail));

module.exports = router;
