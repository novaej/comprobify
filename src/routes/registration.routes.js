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

const LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif']);
const uploadRegistration = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB covers P12 + logo
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'logo' && !LOGO_MIME_TYPES.has(file.mimetype)) {
      return cb(new AppError('Logo must be a PNG, JPEG, or GIF image', 400, ErrorCodes.INVALID_FILE_UPLOAD));
    }
    cb(null, true);
  },
});

const uploadRegistrationFiles = (req, res, next) => {
  uploadRegistration.fields([
    { name: 'cert', maxCount: 1 },
    { name: 'logo', maxCount: 1 },
  ])(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(new AppError(err.message, 400, ErrorCodes.INVALID_FILE_UPLOAD));
    }
    // Normalise: keep req.file pointing at the cert for backward compat with validator
    if (req.files?.cert?.[0]) req.file = req.files.cert[0];
    next(err);
  });
};

router.post('/register', registrationLimiter, uploadRegistrationFiles, register, validateRequest, asyncHandler(controller.register));
router.post('/resend-verification', registrationLimiter, resendVerification, validateRequest, asyncHandler(controller.resendVerification));
router.get('/verify-email', verifyEmail, validateRequest, asyncHandler(controller.verifyEmail));

module.exports = router;
