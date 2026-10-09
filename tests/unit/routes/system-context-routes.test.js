/**
 * Which routes run in RLS system context is a security boundary: a route that
 * should have it and doesn't breaks once policies are enforced, and a
 * tenant-key route that has it would see every tenant's rows.
 */
const systemContext = require('../../../src/middleware/system-context');

const stackOf = (router) => router.stack;
const routeHas = (router, method, path) => {
  const layer = stackOf(router).find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`route not found: ${method} ${path}`);
  return layer.route.stack.some((s) => s.handle === systemContext);
};
const routerLevel = (router) => stackOf(router).some((l) => !l.route && l.handle === systemContext);

describe('system-context routes', () => {
  test('every admin route runs in system context', () => {
    expect(routerLevel(require('../../../src/routes/admin.routes'))).toBe(true);
  });

  test('account-lifecycle routes run in system context, set per route', () => {
    const router = require('../../../src/routes/registration.routes');
    // Mounted at '/', so a router-level middleware would cover all of /v1.
    expect(routerLevel(router)).toBe(false);
    for (const [method, path] of [
      ['post', '/register'], ['post', '/recover'], ['post', '/resend-verification'],
      ['get', '/verify-email/check'], ['post', '/verify-email'],
    ]) {
      expect(routeHas(router, method, path)).toBe(true);
    }
  });

  test('the Mailgun webhook runs in system context', () => {
    expect(routeHas(require('../../../src/routes/mailgun-webhook.routes'), 'post', '/webhook')).toBe(true);
  });

  test.each([
    'documents', 'issuers', 'api-keys', 'tenants', 'payments', 'subscriptions',
    'notifications', 'webhook-endpoints', 'catalogs', 'tiers', 'agreements',
  ])('%s routes never run in system context', (name) => {
    const router = require(`../../../src/routes/${name}.routes`);
    expect(routerLevel(router)).toBe(false);
    for (const layer of stackOf(router)) {
      if (layer.route) expect(layer.route.stack.some((s) => s.handle === systemContext)).toBe(false);
    }
  });
});
