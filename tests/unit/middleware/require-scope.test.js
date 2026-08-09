const requireScope = require('../../../src/middleware/require-scope');

function run(middleware, req) {
  return new Promise((resolve, reject) => {
    middleware(req, {}, (err) => (err ? reject(err) : resolve()));
  });
}

describe('requireScope middleware', () => {
  test('passes through when req.apiKey.scopes includes the required scope', async () => {
    const middleware = requireScope('documents:read');
    const req = { apiKey: { scopes: ['documents:read', 'documents:write'] } };

    await expect(run(middleware, req)).resolves.toBeUndefined();
  });

  test('rejects with 403 INSUFFICIENT_SCOPE when the scope is missing', async () => {
    const middleware = requireScope('issuers:write');
    const req = { apiKey: { scopes: ['documents:read'] } };

    await expect(run(middleware, req)).rejects.toMatchObject({ statusCode: 403, code: 'INSUFFICIENT_SCOPE' });
  });

  test('rejects when req.apiKey is not set', async () => {
    const middleware = requireScope('documents:read');
    const req = {};

    await expect(run(middleware, req)).rejects.toMatchObject({ statusCode: 403, code: 'INSUFFICIENT_SCOPE' });
  });

  test('a different requireScope(scope) instance checks its own scope independently', async () => {
    const req = { apiKey: { scopes: ['documents:read'] } };

    await expect(run(requireScope('documents:read'), req)).resolves.toBeUndefined();
    await expect(run(requireScope('documents:write'), req)).rejects.toMatchObject({ statusCode: 403, code: 'INSUFFICIENT_SCOPE' });
  });
});
