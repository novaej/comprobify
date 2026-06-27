const { Router } = require('express');
const { body, param } = require('express-validator');
const multer = require('multer');
const controller = require('../controllers/issuer.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const { writeLimiter, readLimiter } = require('../middleware/rate-limit');
const { SUPPORTED_TYPES } = require('../builders');
const v = require('../validators/issuer.validator');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

const upload = multer({ storage: multer.memoryStorage() });

const LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif']);
const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!LOGO_MIME_TYPES.has(file.mimetype)) {
      return cb(new AppError('Logo must be a PNG, JPEG, or GIF image', 400, ErrorCodes.INVALID_FILE_UPLOAD));
    }
    cb(null, true);
  },
});

const router = Router();

router.use(authenticate);

const idParam = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('id must be a positive integer'),
];

const addDocumentTypeValidator = [
  body('documentType')
    .isIn(SUPPORTED_TYPES)
    .withMessage(`documentType must be one of: ${SUPPORTED_TYPES.join(', ')}`),
];

const removeDocumentTypeValidator = [
  param('code')
    .isIn(SUPPORTED_TYPES)
    .withMessage(`code must be one of: ${SUPPORTED_TYPES.join(', ')}`),
];

const sequentialDocumentTypeParam = [
  param('documentType')
    .isIn(SUPPORTED_TYPES)
    .withMessage(`documentType must be one of: ${SUPPORTED_TYPES.join(', ')}`),
];

// Tenant-level: list all issuers, create a new branch (no issuer context required)
router.get('/', readLimiter, asyncHandler(controller.list));
router.post('/', writeLimiter, upload.single('cert'), v.createBranch, validateRequest, asyncHandler(controller.createBranch));

const handleLogoUpload = (req, res, next) => {
  uploadLogo.single('logo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(new AppError(err.message, 400, ErrorCodes.INVALID_FILE_UPLOAD));
    }
    next(err);
  });
};

// Single-issuer operations (issuer id in URL; ownership verified in controller)
router.get('/:id', readLimiter, idParam, validateRequest, asyncHandler(controller.getById));
router.patch('/:id', writeLimiter, idParam, v.updateIssuer, validateRequest, asyncHandler(controller.updateIssuer));
router.delete('/:id', writeLimiter, idParam, validateRequest, asyncHandler(controller.removeIssuer));
router.patch('/:id/activate', writeLimiter, idParam, validateRequest, asyncHandler(controller.activateIssuer));
router.patch('/:id/logo', writeLimiter, idParam, validateRequest, handleLogoUpload, asyncHandler(controller.uploadLogo));
router.patch('/:id/certificate', writeLimiter, upload.single('cert'), idParam, validateRequest, asyncHandler(controller.renewCertificate));
router.get('/:id/document-types', readLimiter, idParam, validateRequest, asyncHandler(controller.listDocumentTypes));
router.post('/:id/document-types', writeLimiter, idParam, addDocumentTypeValidator, validateRequest, asyncHandler(controller.addDocumentType));
router.delete('/:id/document-types/:code', writeLimiter, idParam, removeDocumentTypeValidator, validateRequest, asyncHandler(controller.removeDocumentType));
router.get('/:id/sequentials', readLimiter, idParam, validateRequest, asyncHandler(controller.getSequentials));
router.patch('/:id/sequentials/:documentType', writeLimiter, idParam, sequentialDocumentTypeParam, v.setSequential, validateRequest, asyncHandler(controller.setSequential));

module.exports = router;
