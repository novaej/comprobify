// Regression guard for ADR-035 (Common Mistake #53/#54): every route that only
// comprobify-web's BFF may call must carry requireInternalService.
const registration = require('../../../src/routes/registration.routes');
const tenants = require('../../../src/routes/tenants.routes');
const agreements = require('../../../src/routes/agreements.routes');
const subscriptions = require('../../../src/routes/subscriptions.routes');
const payments = require('../../../src/routes/payments.routes');

function routeLayerNames(router, method, path) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack.map((s) => s.name);
}

// Router-level `router.use(requireInternalService)` (agreements) shows up as a
// non-route layer.
function hasRouterLevelGate(router) {
  return router.stack.some((l) => !l.route && l.name === 'requireInternalService');
}

describe('frontend-only routes require requireInternalService', () => {
  const gated = [
    ['registration POST /register', registration, 'post', '/register'],
    ['registration POST /recover', registration, 'post', '/recover'],
    ['registration POST /resend-verification', registration, 'post', '/resend-verification'],
    ['registration POST /verify-email', registration, 'post', '/verify-email'],
    ['tenants POST /promote', tenants, 'post', '/promote'],
    ['tenants GET /agreements', tenants, 'get', '/agreements'],
    ['tenants POST /agreements', tenants, 'post', '/agreements'],
    ['tenants GET /agreements/history', tenants, 'get', '/agreements/history'],
    ['tenants GET /agreements/:type', tenants, 'get', '/agreements/:type'],
    ['subscriptions POST /', subscriptions, 'post', '/'],
    ['subscriptions POST /change-tier', subscriptions, 'post', '/change-tier'],
    ['subscriptions POST /seats', subscriptions, 'post', '/seats'],
    ['subscriptions DELETE /', subscriptions, 'delete', '/'],
    ['payments DELETE /:id', payments, 'delete', '/:id'],
    ['payments PATCH /:id/proof', payments, 'patch', '/:id/proof'],
    ['payments DELETE /:id/proofs/:proofId', payments, 'delete', '/:id/proofs/:proofId'],
    ['payments POST /payphone/confirm', payments, 'post', '/payphone/confirm'],
    ['payments POST /:id/payphone-session', payments, 'post', '/:id/payphone-session'],
  ];

  test.each(gated)('%s', (_label, router, method, path) => {
    expect(routeLayerNames(router, method, path)).toContain('requireInternalService');
  });

  test('every agreements (public) route is gated at router level', () => {
    expect(hasRouterLevelGate(agreements)).toBe(true);
  });

  test('the read-only verification check stays reachable without the gate', () => {
    expect(routeLayerNames(registration, 'get', '/verify-email/check'))
      .not.toContain('requireInternalService');
  });
});
