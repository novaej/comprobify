const { Router } = require('express');
const multer = require('multer');
const controller = require('../controllers/admin.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticateAdmin = require('../middleware/authenticate-admin');
const { adminLimiter } = require('../middleware/rate-limit');
const v = require('../validators/admin.validator');

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(adminLimiter);
router.use(authenticateAdmin);

// Tenants
router.get('/tenants',                                                           asyncHandler(controller.listTenants));
router.patch('/tenants/:id/tier',        v.updateTenantTier,   validateRequest, asyncHandler(controller.updateTenantTier));
router.patch('/tenants/:id/status',      v.updateTenantStatus, validateRequest, asyncHandler(controller.updateTenantStatus));
router.post('/tenants/:id/verify',       v.verifyTenant,       validateRequest, asyncHandler(controller.verifyTenant));
router.post('/tenants/:id/promote',      v.promoteTenant,      validateRequest, asyncHandler(controller.promoteTenant));
router.get('/tenants/:id/events',        v.listTenantEvents,   validateRequest, asyncHandler(controller.listTenantEvents));

// Issuers
router.get('/issuers',                                                           asyncHandler(controller.listIssuers));
router.patch('/issuers/:id/certificate', upload.single('cert'), v.renewIssuerCertificate, validateRequest, asyncHandler(controller.renewIssuerCertificate));

// API keys (tenant-scoped)
router.post('/tenants/:id/api-keys', v.createApiKey,       validateRequest, asyncHandler(controller.createApiKey));
router.get('/tenants/:id/api-keys',  v.listApiKeys,        validateRequest, asyncHandler(controller.listApiKeys));
router.get('/tenants/:id/api-keys/:keyId/usage', v.getApiKeyUsage, validateRequest, asyncHandler(controller.getApiKeyUsage));
router.delete('/api-keys/:id',       v.revokeApiKey,       validateRequest, asyncHandler(controller.revokeApiKey));

// Webhook endpoints (tenant-scoped) — mints/replaces a reserved (comprobify-web-
// internal) endpoint or an ordinary one, mirroring the api-keys routes above.
router.post('/tenants/:id/webhook-endpoints', v.createWebhookEndpoint, validateRequest, asyncHandler(controller.createWebhookEndpoint));

// Subscriptions & payments
router.post('/tenants/:id/subscriptions',       v.createSubscription, validateRequest, asyncHandler(controller.createSubscription));
router.get('/tenants/:id/subscriptions',        v.listSubscriptions,  validateRequest, asyncHandler(controller.listSubscriptions));
router.patch('/subscriptions/:id/link-invoice', v.linkInvoice,        validateRequest, asyncHandler(controller.linkInvoice));
router.patch('/subscriptions/:id/cancel',       v.cancelSubscription, validateRequest, asyncHandler(controller.cancelSubscription));
router.get('/payments',                         v.listPayments,       validateRequest, asyncHandler(controller.listPayments));
router.patch('/payments/:id/review',            v.reviewPayment,      validateRequest, asyncHandler(controller.reviewPayment));
router.patch('/payments/:id/refund',            v.refundPayment,      validateRequest, asyncHandler(controller.refundPayment));
router.get('/payments/:id/proofs',              v.listPaymentProofs,  validateRequest, asyncHandler(controller.listPaymentProofs));
router.get('/payments/:id/proofs/:proofId',     v.getPaymentProof,    validateRequest, asyncHandler(controller.getPaymentProof));

// Invoicing queue — verified payments whose factura the operator still owes.
router.get('/invoicing/pending', asyncHandler(controller.listPendingInvoices));

// Documents
router.get('/documents/:accessKey/ride', asyncHandler(controller.getDocumentRide));

// Agreements
router.post('/agreements', v.publishAgreement, validateRequest, asyncHandler(controller.publishAgreement));
router.get('/agreements/versions/:id', v.getAgreementVersion, validateRequest, asyncHandler(controller.getAgreementVersion));
router.get('/agreements/:type/versions', v.listAgreementVersions, validateRequest, asyncHandler(controller.listAgreementVersions));
router.patch('/agreements/:id/activate', v.activateAgreement, validateRequest, asyncHandler(controller.activateAgreement));

// Notification email templates (ADR-024 Phase C)
router.post('/notification-email-templates', v.publishNotificationEmailTemplate, validateRequest, asyncHandler(controller.publishNotificationEmailTemplate));
router.get('/notification-email-templates', asyncHandler(controller.listCurrentNotificationEmailTemplates));
router.get('/notification-email-templates/versions/:id', v.getNotificationEmailTemplateVersion, validateRequest, asyncHandler(controller.getNotificationEmailTemplateVersion));
router.get('/notification-email-templates/:type/:language/versions', v.listNotificationEmailTemplateVersions, validateRequest, asyncHandler(controller.listNotificationEmailTemplateVersions));
router.patch('/notification-email-templates/:id/activate', v.activateNotificationEmailTemplate, validateRequest, asyncHandler(controller.activateNotificationEmailTemplate));

// Tier prices
router.post('/prices',            v.createTierPrice,  validateRequest, asyncHandler(controller.createTierPrice));
router.get('/prices',             v.listTierPrices,    validateRequest, asyncHandler(controller.listTierPrices));
router.get('/prices/:id',         v.getTierPrice,      validateRequest, asyncHandler(controller.getTierPrice));
router.patch('/prices/:id',       v.updateTierPrice,   validateRequest, asyncHandler(controller.updateTierPrice));
router.post('/prices/:id/publish', v.publishTierPrice, validateRequest, asyncHandler(controller.publishTierPrice));

// Seat prices (ADR-032) — sibling of /prices, not a rename: /prices stays the
// tier-price surface, seat prices get their own path since they have no
// `tier` dimension.
router.post('/seat-prices',            v.createSeatPrice,  validateRequest, asyncHandler(controller.createSeatPrice));
router.get('/seat-prices',             asyncHandler(controller.listSeatPrices));
router.get('/seat-prices/:id',         v.getSeatPrice,     validateRequest, asyncHandler(controller.getSeatPrice));
router.patch('/seat-prices/:id',       v.updateSeatPrice,  validateRequest, asyncHandler(controller.updateSeatPrice));
router.post('/seat-prices/:id/publish', v.publishSeatPrice, validateRequest, asyncHandler(controller.publishSeatPrice));

// Jobs
router.post('/jobs/notifications', asyncHandler(controller.runNotificationJobs));
router.post('/jobs/subscriptions', asyncHandler(controller.runSubscriptionJobs));
router.post('/jobs/quota', asyncHandler(controller.runQuotaJobs));
router.post('/jobs/queue-reconciliation', asyncHandler(controller.runQueueReconciliationJob));
router.post('/jobs/payphone-reconciliation', asyncHandler(controller.runPayphoneReconciliationJob));

module.exports = router;
