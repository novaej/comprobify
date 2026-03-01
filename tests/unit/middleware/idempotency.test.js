const extractIdempotencyKey = require('../../../src/middleware/idempotency');

function makeReq(headers = {}) {
  return { headers };
}

describe('extractIdempotencyKey middleware', () => {
  test('sets req.idempotencyKey to null when header is absent', () => {
    const req = makeReq({});
    const next = jest.fn();
    extractIdempotencyKey(req, {}, next);
    expect(req.idempotencyKey).toBeNull();
    expect(next).toHaveBeenCalledWith();
  });

  test('sets req.idempotencyKey to the header value when present', () => {
    const req = makeReq({ 'idempotency-key': 'order-xyz-789' });
    const next = jest.fn();
    extractIdempotencyKey(req, {}, next);
    expect(req.idempotencyKey).toBe('order-xyz-789');
    expect(next).toHaveBeenCalledWith();
  });

  test('throws AppError 400 when header is an empty string', () => {
    const req = makeReq({ 'idempotency-key': '' });
    expect(() => extractIdempotencyKey(req, {}, jest.fn())).toThrow(
      expect.objectContaining({ statusCode: 400 })
    );
  });

  test('throws AppError 400 when header is whitespace only', () => {
    const req = makeReq({ 'idempotency-key': '   ' });
    expect(() => extractIdempotencyKey(req, {}, jest.fn())).toThrow(
      expect.objectContaining({ statusCode: 400 })
    );
  });

  test('throws AppError 400 when header exceeds 255 characters', () => {
    const req = makeReq({ 'idempotency-key': 'x'.repeat(256) });
    expect(() => extractIdempotencyKey(req, {}, jest.fn())).toThrow(
      expect.objectContaining({ statusCode: 400 })
    );
  });

  test('accepts a key of exactly 255 characters', () => {
    const req = makeReq({ 'idempotency-key': 'x'.repeat(255) });
    const next = jest.fn();
    extractIdempotencyKey(req, {}, next);
    expect(req.idempotencyKey).toHaveLength(255);
    expect(next).toHaveBeenCalledWith();
  });
});
