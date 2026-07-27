const { Router } = require('express');
const controller = require('../controllers/tiers.controller');
const asyncHandler = require('../middleware/async-handler');

const router = Router();

// Public — no auth, no rate limiter. Prices are now resolved from the DB
// (pricingService), so this is no longer a pure sync passthrough — needs
// asyncHandler like any other async route (CLAUDE.md rule #8).
router.get('/', asyncHandler(controller.list));

module.exports = router;
