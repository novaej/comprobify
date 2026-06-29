const { Router } = require('express');
const controller = require('../controllers/tiers.controller');

const router = Router();

// Public — no auth, no rate limiter. Static catalog data, nothing abuse-sensitive.
router.get('/', controller.list);

module.exports = router;
