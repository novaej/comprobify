const { Router } = require('express');
const controller = require('../controllers/subscription.controller');
const asyncHandler = require('../middleware/async-handler');
const validateRequest = require('../middleware/validate-request');
const authenticate = require('../middleware/authenticate');
const requireInternalService = require('../middleware/require-internal-service');
const requireNotSuspended = require('../middleware/require-not-suspended');
const requireNotPastDue = require('../middleware/require-past-due');
const requireScope = require('../middleware/require-scope');
const { ApiKeyScopes } = require('../constants/api-key-scopes');
const { readLimiter, writeLimiter } = require('../middleware/rate-limit');
const v = require('../validators/subscription.validator');

const router = Router();

router.use(authenticate);
router.use(requireScope(ApiKeyScopes.BILLING_MANAGE));

// A SUSPENDED tenant may still view their own subscription/payment history.
// This read stays reachable with just the tenant's own API key — no
// requireInternalService — same split as GET /v1/verify-email/check.
router.get('/me', readLimiter, asyncHandler(controller.getMyStatus));
// Every mutation below additionally requires requireInternalService (ADR-035
// extension) — comprobify-web's own BFF must be the caller, using one of its
// reserved-for-frontend API keys (see effectiveApiKeyLimit()/ADR-034) to
// still resolve req.tenant via the normal authenticate chain above. This is
// an ADDITIONAL gate on top of authenticate + billing:manage, not a
// replacement — both a valid tenant API key AND a valid
// X-Internal-Service-Secret are required. Unlike registration (an anonymous,
// abuse-prone action), these routes are already tenant-authenticated; the
// gate exists so billing mutations always flow through comprobify-web's own
// UX/checkout, not because of an anonymous-abuse concern.
//
// POST / is deliberately NOT gated by requireNotPastDue (still gated by
// requireNotSuspended) — starting a fresh subscription is the self-service
// recovery path back to ACTIVE for a PAST_DUE tenant. See
// docs/adr/025-past-due-tenant-status.md.
router.post('/', writeLimiter, requireInternalService, requireNotSuspended, v.createSubscription, validateRequest, asyncHandler(controller.createSubscription));
router.post('/change-tier', writeLimiter, requireInternalService, requireNotSuspended, requireNotPastDue, v.changeTier, validateRequest, asyncHandler(controller.changeTier));
router.post('/seats', writeLimiter, requireInternalService, requireNotSuspended, requireNotPastDue, v.changeSeats, validateRequest, asyncHandler(controller.changeSeats));
router.delete('/', writeLimiter, requireInternalService, requireNotSuspended, requireNotPastDue, asyncHandler(controller.cancelSubscription));

module.exports = router;
