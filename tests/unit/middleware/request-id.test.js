const requestId = require('../../../src/middleware/request-id');

function makeRes() {
  return { set: jest.fn() };
}

describe('requestId middleware', () => {
  test('sets req.requestId to a UUID', () => {
    const req = {};
    const res = makeRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(req.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('sets the X-Request-Id response header to the same value', () => {
    const req = {};
    const res = makeRes();
    const next = jest.fn();

    requestId(req, res, next);

    expect(res.set).toHaveBeenCalledWith('X-Request-Id', req.requestId);
  });

  test('generates a different id on each call', () => {
    const req1 = {};
    const req2 = {};
    requestId(req1, makeRes(), jest.fn());
    requestId(req2, makeRes(), jest.fn());

    expect(req1.requestId).not.toBe(req2.requestId);
  });

  test('calls next() exactly once', () => {
    const next = jest.fn();
    requestId({}, makeRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });
});
