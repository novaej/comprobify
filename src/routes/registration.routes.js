const { Router } = require('express');
const multer = require('multer');
const controller = require('../controllers/registration.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const { register, recover, resendVerification, verifyEmail, verifyEmailBody } = require('../validators/registration.validator');
const { registrationLimiter } = require('../middleware/rate-limit');
const requireInternalService = require('../middleware/require-internal-service');
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

// Account creation/recovery/activation is only ever called by comprobify-web's
// own server-side BFF, never directly by a third-party integrator or a
// visitor's browser (ADR-035) — requireInternalService rejects anything that
// doesn't carry a valid X-Internal-Service-Secret before any other work runs.
router.post('/register', requireInternalService, registrationLimiter, uploadRegistrationFiles, register, validateRequest, asyncHandler(controller.register));
router.post('/recover', requireInternalService, registrationLimiter, uploadRecoveryFile, recover, validateRequest, asyncHandler(controller.recover));
router.post('/resend-verification', requireInternalService, registrationLimiter, resendVerification, validateRequest, asyncHandler(controller.resendVerification));
// Read-only check — safe for email link-scanners (Microsoft Defender/Safe
// Links etc.) to prefetch repeatedly without burning the token, and doesn't
// create or activate anything — left reachable without requireInternalService.
router.get('/verify-email/check', verifyEmail, validateRequest, asyncHandler(controller.checkVerifyEmail));
// The actual consuming action (activates the tenant) — gated the same as
// register/recover above. POST-only so an automated scanner's GET prefetch
// could never have triggered it even before this gate existed.
router.post('/verify-email', requireInternalService, verifyEmailBody, validateRequest, asyncHandler(controller.confirmVerifyEmail));

module.exports = router;
