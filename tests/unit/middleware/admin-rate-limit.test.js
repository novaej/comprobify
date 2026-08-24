jest.mock('../../../src/services/redis.service');

const express = require('express');

const SECRET = 'a'.repeat(64);
const MAX = 3;

// Spins up a real express app around the real adminLimiter + authenticateAdmin.
// The behaviour under test is the interaction between the two — the limiter
// counts a request only when authenticate-admin.js did NOT set
// req.adminAuthenticated — so mocking either side would prove nothing.
function startServer() {
  jest.resetModules();
  process.env.ADMIN_RATE_LIMIT_MAX = String(MAX);
  process.env.ADMIN_SECRET = SECRET;

  const redisService = require('../../../src/services/redis.service');
  redisService.getClient.mockReturnValue(null); // in-memory store

  const { adminLimiter } = require('../../../src/middleware/rate-limit');
  const authenticateAdmin = require('../../../src/middleware/authenticate-admin');

  const app = express();
  app.use(adminLimiter);
  app.use(authenticateAdmin);
  app.get('/ok', (_req, res) => res.json({ ok: true }));
  // A legitimate operator hitting a missing resource — must not count as a
  // guessing attempt even though it's a 4xx.
  app.get('/missing', (_req, res) => res.status(404).json({ ok: false }));
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('adminLimiter', () => {
  let server;
  let base;
  const origEnv = { ...process.env };

  beforeEach(async () => {
    server = await startServer();
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    process.env = { ...origEnv };
  });

  const get = (path, secret) =>
    fetch(base + path, secret ? { headers: { Authorization: `Bearer ${secret}` } } : undefined);

  test('an authenticated operator is never throttled, well past the limit', async () => {
    for (let i = 0; i < MAX * 4; i++) {
      const res = await get('/ok', SECRET);
      expect(res.status).toBe(200);
    }
  });

  test('a 4xx from an authenticated operator does not count against the budget', async () => {
    for (let i = 0; i < MAX * 3; i++) {
      const res = await get('/missing', SECRET);
      expect(res.status).toBe(404); // never 429
    }
  });

  test('failed auth attempts are counted and blocked at the limit', async () => {
    for (let i = 0; i < MAX; i++) {
      expect((await get('/ok', 'b'.repeat(64))).status).toBe(401);
    }

    const blocked = await get('/ok', 'b'.repeat(64));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).code).toBe('TOO_MANY_REQUESTS');
  });

  test('a missing Authorization header counts the same as a wrong secret', async () => {
    for (let i = 0; i < MAX; i++) {
      expect((await get('/ok')).status).toBe(401);
    }
    expect((await get('/ok')).status).toBe(429);
  });

  // Documents an accepted trade-off rather than a bug. The limiter runs BEFORE
  // authenticateAdmin, so once an IP has spent its failure budget everything
  // from that IP is refused for the rest of the window — a valid secret
  // included. Letting a valid secret through would require checking it before
  // rate limiting, which is precisely what reopens unlimited guessing.
  //
  // Operationally this means a service misconfigured with the WRONG
  // ADMIN_SECRET locks out its own IP, and fixing the config still leaves the
  // remainder of the window to wait out. That is the intended failure mode.
  test('a spent failure budget also blocks a valid secret until the window rolls', async () => {
    for (let i = 0; i < MAX; i++) {
      expect((await get('/ok', 'b'.repeat(64))).status).toBe(401);
    }

    expect((await get('/ok', SECRET)).status).toBe(429);
  });
});
