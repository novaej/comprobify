const { Router } = require('express');
const multer = require('multer');
const controller = require('../controllers/admin.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticateAdmin = require('../middleware/authenticate-admin');
const { adminLimiter } = require('../middleware/rate-limit');
const v = require('../validators/admin.validator');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const LEGAL_DOCUMENT_MIME_TYPES = new Set(['application/pdf']);
const uploadLegalDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!LEGAL_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      return cb(new AppError('Legal document must be a PDF file', 400, ErrorCodes.INVALID_FILE_UPLOAD));
    }
    cb(null, true);
  },
});

router.use(adminLimiter);
router.use(authenticateAdmin);

// Tenants
router.post('/tenants',                  v.createTenant,       validateRequest, asyncHandler(controller.createTenant));
router.get('/tenants',                                                           asyncHandler(controller.listTenants));
router.patch('/tenants/:id/tier',        v.updateTenantTier,   validateRequest, asyncHandler(controller.updateTenantTier));
router.patch('/tenants/:id/status',      v.updateTenantStatus, validateRequest, asyncHandler(controller.updateTenantStatus));
router.post('/tenants/:id/verify',       v.verifyTenant,       validateRequest, asyncHandler(controller.verifyTenant));
router.post('/tenants/:id/promote',      v.promoteTenant,      validateRequest, asyncHandler(controller.promoteTenant));

// Issuers
router.post('/issuers', upload.single('cert'), v.createIssuer, validateRequest, asyncHandler(controller.createIssuer));
router.get('/issuers',                                                           asyncHandler(controller.listIssuers));
router.patch('/issuers/:id/certificate', upload.single('cert'), v.renewIssuerCertificate, validateRequest, asyncHandler(controller.renewIssuerCertificate));

// API keys (tenant-scoped)
router.post('/tenants/:id/api-keys', v.createApiKey,       validateRequest, asyncHandler(controller.createApiKey));
router.delete('/api-keys/:id',       v.revokeApiKey,       validateRequest, asyncHandler(controller.revokeApiKey));

// Subscriptions & payments
router.post('/tenants/:id/subscriptions',       v.createSubscription, validateRequest, asyncHandler(controller.createSubscription));
router.get('/tenants/:id/subscriptions',        v.listSubscriptions,  validateRequest, asyncHandler(controller.listSubscriptions));
router.patch('/subscriptions/:id/link-invoice', v.linkInvoice,        validateRequest, asyncHandler(controller.linkInvoice));
router.patch('/subscriptions/:id/cancel',       v.cancelSubscription, validateRequest, asyncHandler(controller.cancelSubscription));
router.get('/payments',                         v.listPayments,       validateRequest, asyncHandler(controller.listPayments));
router.patch('/payments/:id/review',            v.reviewPayment,      validateRequest, asyncHandler(controller.reviewPayment));
router.get('/payments/:id/proof',               v.getPaymentProof,    validateRequest, asyncHandler(controller.getPaymentProof));

// Legal documents
const handleLegalDocumentUpload = (req, res, next) => {
  uploadLegalDocument.single('document')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(new AppError(err.message, 400, ErrorCodes.INVALID_FILE_UPLOAD));
    }
    next(err);
  });
};
router.post('/legal-documents', handleLegalDocumentUpload, v.publishLegalDocument, validateRequest, asyncHandler(controller.publishLegalDocument));

// Jobs
router.post('/jobs/notifications', asyncHandler(controller.runNotificationJobs));
router.post('/jobs/subscriptions', asyncHandler(controller.runSubscriptionJobs));

module.exports = router;
