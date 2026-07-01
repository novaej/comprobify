const { Router } = require('express');
const controller = require('../controllers/legal-document.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const v = require('../validators/agreement.validator');

const router = Router();

// Public — no auth, no rate limiter. Same precedent as /v1/tiers: static content
// any frontend or third-party integrator needs before/during signup.
router.get('/documents', asyncHandler(controller.list));
router.get('/documents/:type', v.getByType, validateRequest, asyncHandler(controller.getByType));

module.exports = router;
