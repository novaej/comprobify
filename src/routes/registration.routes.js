const { Router } = require('express');
const multer = require('multer');
const controller = require('../controllers/registration.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const { register, recover, resendVerification, verifyEmail, verifyEmailBody } = require('../validators/registration.validator');
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

const uploadRecoveryCert = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB — a bare P12 (no logo to accommodate)
});

const uploadRecoveryFile = (req, res, next) => {
  uploadRecoveryCert.single('cert')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(new AppError(err.message, 400, ErrorCodes.INVALID_FILE_UPLOAD));
    }
    next(err);
  });
};

router.post('/register', registrationLimiter, uploadRegistrationFiles, register, validateRequest, asyncHandler(controller.register));
router.post('/recover', registrationLimiter, uploadRecoveryFile, recover, validateRequest, asyncHandler(controller.recover));
router.post('/resend-verification', registrationLimiter, resendVerification, validateRequest, asyncHandler(controller.resendVerification));
// Legacy fallback: still reachable when no verificationRedirectUrl was set
// (e.g. a direct API caller bypassing comprobify-web), so it stays a
// consuming GET for backward compatibility. comprobify-web itself never
// calls this directly — see /verify-email/check and the POST below.
router.get('/verify-email', verifyEmail, validateRequest, asyncHandler(controller.verifyEmail));
// Read-only check — safe for email link-scanners (Microsoft Defender/Safe
// Links etc.) to prefetch repeatedly without burning the token. The
// frontend calls this on page load.
router.get('/verify-email/check', verifyEmail, validateRequest, asyncHandler(controller.checkVerifyEmail));
// The actual consuming action. POST-only so an automated scanner's GET
// prefetch can never trigger it — only an explicit user click can. The
// frontend calls this from a button, not from page render.
router.post('/verify-email', verifyEmailBody, validateRequest, asyncHandler(controller.confirmVerifyEmail));

module.exports = router;
