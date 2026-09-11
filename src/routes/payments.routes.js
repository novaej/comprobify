const { Router } = require('express');
const { param, body } = require('express-validator');
const multer = require('multer');
const controller = require('../controllers/payment.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const requireInternalService = require('../middleware/require-internal-service');
const requireNotSuspended = require('../middleware/require-not-suspended');
const requireNotPastDue = require('../middleware/require-past-due');
const requireScope = require('../middleware/require-scope');
const { ApiKeyScopes } = require('../constants/api-key-scopes');
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
router.use(requireScope(ApiKeyScopes.BILLING_MANAGE));

const idParam = [param('id').isUUID().withMessage('id must be a valid UUID')];
const idAndProofIdParams = [
  param('id').isUUID().withMessage('id must be a valid UUID'),
  param('proofId').isUUID().withMessage('proofId must be a valid UUID'),
];
// Payphone's return redirect echoes back its own transaction id plus the
// clientTransactionId we minted. Both are required to confirm a charge.
const confirmPayphoneFields = [
  body('id').notEmpty().withMessage('id (Payphone transaction id) is required'),
  body('clientTransactionId')
    .trim()
    .notEmpty()
    .isLength({ max: 50 })
    .withMessage('clientTransactionId is required and must be at most 50 characters'),
];

const submitProofFields = [
  ...idParam,
  body('referenceNumber')
    .trim()
    .notEmpty()
    .withMessage('referenceNumber is required')
    .isLength({ max: 50 })
    .withMessage('referenceNumber must be at most 50 characters'),
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

// Every mutation below additionally requires requireInternalService (ADR-035
// extension, mirrors subscriptions.routes.js) — comprobify-web's own BFF must
// be the caller, on top of (not instead of) the normal tenant-API-key
// authenticate + billing:manage chain above.

// Cancel a still-PENDING payment (wrong tier/seat count, never submitted
// proof) — see subscription.service.js's cancelPayment.
router.delete('/:id', writeLimiter, requireInternalService, requireNotSuspended, requireNotPastDue, idParam, validateRequest, asyncHandler(controller.cancelPayment));

// A SUSPENDED tenant may still view/download proof files already submitted —
// relevant precisely when the suspension itself is payment-related. These
// two reads stay reachable with just the tenant's own API key — no
// requireInternalService — same split as GET /v1/subscriptions/me.
router.get('/:id/proofs', readLimiter, idParam, validateRequest, asyncHandler(controller.listProofs));
router.get('/:id/proofs/:proofId', readLimiter, idAndProofIdParams, validateRequest, asyncHandler(controller.downloadProof));
// PATCH /:id/proof is deliberately NOT gated by requireNotPastDue (still
// gated by requireNotSuspended) — submitting payment proof is the other half
// of the self-service recovery path for a PAST_DUE tenant. See
// docs/adr/025-past-due-tenant-status.md.
router.patch('/:id/proof', writeLimiter, requireInternalService, requireNotSuspended, handleProofUpload, submitProofFields, validateRequest, asyncHandler(controller.submitProof));
router.delete('/:id/proofs/:proofId', writeLimiter, requireInternalService, requireNotSuspended, requireNotPastDue, idAndProofIdParams, validateRequest, asyncHandler(controller.deleteProof));

// Card payments (ADR-028), also exempt from requireNotPastDue. '/payphone/confirm'
// must precede the '/:id/...' routes or UUID validation rejects it.
router.post('/payphone/confirm', writeLimiter, requireInternalService, requireNotSuspended, confirmPayphoneFields, validateRequest, asyncHandler(controller.confirmPayphone));
router.post('/:id/payphone-session', writeLimiter, requireInternalService, requireNotSuspended, idParam, validateRequest, asyncHandler(controller.createPayphoneSession));

module.exports = router;
