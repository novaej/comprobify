const { Router } = require('express');
const { param } = require('express-validator');
const multer = require('multer');
const controller = require('../controllers/payment.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const requireNotSuspended = require('../middleware/require-not-suspended');
const { writeLimiter, readLimiter } = require('../middleware/rate-limit');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

const PROOF_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'application/pdf']);
const MAX_FILES_PER_UPLOAD = 5;
const uploadProof = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: MAX_FILES_PER_UPLOAD },
  fileFilter: (_req, file, cb) => {
    if (!PROOF_MIME_TYPES.has(file.mimetype)) {
      return cb(new AppError('Proof file must be a PNG, JPEG, GIF, or PDF', 400, ErrorCodes.INVALID_FILE_UPLOAD));
    }
    cb(null, true);
  },
});

const router = Router();

router.use(authenticate);

const idParam = [param('id').isInt({ min: 1 }).withMessage('id must be a positive integer')];
const idAndProofIdParams = [
  param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
  param('proofId').isInt({ min: 1 }).withMessage('proofId must be a positive integer'),
];

// Field name 'proof' repeated per file — the standard multipart convention
// for uploading an array of files in one request.
const handleProofUpload = (req, res, next) => {
  uploadProof.array('proof', MAX_FILES_PER_UPLOAD)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(new AppError(err.message, 400, ErrorCodes.INVALID_FILE_UPLOAD));
    }
    next(err);
  });
};

// A SUSPENDED tenant may still view/download proof files already submitted —
// relevant precisely when the suspension itself is payment-related.
router.get('/:id/proofs', readLimiter, idParam, validateRequest, asyncHandler(controller.listProofs));
router.get('/:id/proofs/:proofId', readLimiter, idAndProofIdParams, validateRequest, asyncHandler(controller.downloadProof));
router.patch('/:id/proof', writeLimiter, requireNotSuspended, handleProofUpload, idParam, validateRequest, asyncHandler(controller.submitProof));
router.delete('/:id/proofs/:proofId', writeLimiter, requireNotSuspended, idAndProofIdParams, validateRequest, asyncHandler(controller.deleteProof));

module.exports = router;
