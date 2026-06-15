const { Router } = require('express');
const multer = require('multer');
const controller = require('../controllers/registration.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const { register, resendVerification, verifyEmail } = require('../validators/registration.validator');
const { registrationLimiter } = require('../middleware/rate-limit');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const uploadCert = (req, res, next) => {
  upload.single('cert')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(new AppError(err.message, 400, ErrorCodes.INVALID_FILE_UPLOAD));
    }
    next(err);
  });
};

router.post('/register', registrationLimiter, uploadCert, register, validateRequest, asyncHandler(controller.register));
router.post('/resend-verification', registrationLimiter, resendVerification, validateRequest, asyncHandler(controller.resendVerification));
router.get('/verify-email', verifyEmail, validateRequest, asyncHandler(controller.verifyEmail));

module.exports = router;
