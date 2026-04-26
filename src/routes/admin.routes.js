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
router.post('/tenants',             v.createTenant,       validateRequest, asyncHandler(controller.createTenant));
router.get('/tenants',                                                      asyncHandler(controller.listTenants));
router.patch('/tenants/:id/tier',   v.updateTenantTier,   validateRequest, asyncHandler(controller.updateTenantTier));
router.patch('/tenants/:id/status', v.updateTenantStatus, validateRequest, asyncHandler(controller.updateTenantStatus));
router.post('/tenants/:id/verify',  v.verifyTenant,       validateRequest, asyncHandler(controller.verifyTenant));

// Issuers
router.post('/issuers', upload.single('cert'), v.createIssuer, validateRequest, asyncHandler(controller.createIssuer));
router.get('/issuers',                                                           asyncHandler(controller.listIssuers));
router.post('/issuers/:id/promote', v.promoteIssuer,       validateRequest, asyncHandler(controller.promoteIssuer));

// API keys
router.post('/issuers/:id/api-keys', v.createApiKey,       validateRequest, asyncHandler(controller.createApiKey));
router.delete('/api-keys/:id',       v.revokeApiKey,       validateRequest, asyncHandler(controller.revokeApiKey));

module.exports = router;
