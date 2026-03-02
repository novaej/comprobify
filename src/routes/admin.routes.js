const { Router } = require('express');
const multer = require('multer');
const controller = require('../controllers/admin.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticateAdmin = require('../middleware/authenticate-admin');
const { createIssuer, createApiKey, revokeApiKey } = require('../validators/admin.validator');

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(authenticateAdmin);

router.post('/issuers', upload.single('cert'), createIssuer, validateRequest, asyncHandler(controller.createIssuer));
router.get('/issuers', asyncHandler(controller.listIssuers));
router.post('/issuers/:id/api-keys', createApiKey, validateRequest, asyncHandler(controller.createApiKey));
router.delete('/api-keys/:id', revokeApiKey, validateRequest, asyncHandler(controller.revokeApiKey));

module.exports = router;
