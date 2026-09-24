const { Router } = require('express');
const controller = require('../controllers/agreement.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const requireInternalService = require('../middleware/require-internal-service');
const v = require('../validators/agreement.validator');

const router = Router();

// No tenant auth (a visitor reads these before signing up), but frontend-only: only
// comprobify-web's BFF renders and proxies legal documents (ADR-035).
router.use(requireInternalService);

router.get('/', asyncHandler(controller.list));
router.get('/:type', v.getByType, validateRequest, asyncHandler(controller.getByType));

module.exports = router;
