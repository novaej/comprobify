const { Router } = require('express');
const { param } = require('express-validator');
const multer = require('multer');
const controller = require('../controllers/payment.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const { writeLimiter, readLimiter } = require('../middleware/rate-limit');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

const PROOF_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'application/pdf']);
const uploadProof = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
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

const handleProofUpload = (req, res, next) => {
  uploadProof.single('proof')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(new AppError(err.message, 400, ErrorCodes.INVALID_FILE_UPLOAD));
    }
    next(err);
  });
};

router.get('/:id/proof', readLimiter, idParam, validateRequest, asyncHandler(controller.getProof));
router.patch('/:id/proof', writeLimiter, handleProofUpload, idParam, validateRequest, asyncHandler(controller.submitProof));

module.exports = router;
