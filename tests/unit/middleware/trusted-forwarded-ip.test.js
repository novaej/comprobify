process.env.INTERNAL_SERVICE_SECRET = 'correct-secret';

const trustedForwardedIp = require('../../../src/middleware/trusted-forwarded-ip');

function makeReq(headers, ip) {
  return { headers, ip: ip || '162.158.63.169' };
}

describe('trustedForwardedIp middleware', () => {
  test('overrides req.ip when the secret matches and a visitor IP is present', () => {
    const req = makeReq({
      'x-internal-service-secret': 'correct-secret',
      'x-forwarded-visitor-ip': '203.0.113.7',
    });
    const next = jest.fn();

    trustedForwardedIp(req, {}, next);

    expect(req.ip).toBe('203.0.113.7');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('leaves req.ip untouched when the secret does not match', () => {
    const req = makeReq({
      'x-internal-service-secret': 'wrong-secret',
      'x-forwarded-visitor-ip': '203.0.113.7',
    });
    const next = jest.fn();

    trustedForwardedIp(req, {}, next);

    expect(req.ip).toBe('162.158.63.169');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('leaves req.ip untouched when the secret header is absent', () => {
    const req = makeReq({ 'x-forwarded-visitor-ip': '203.0.113.7' });
    const next = jest.fn();

    trustedForwardedIp(req, {}, next);

    expect(req.ip).toBe('162.158.63.169');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('leaves req.ip untouched when the visitor IP header is absent', () => {
    const req = makeReq({ 'x-internal-service-secret': 'correct-secret' });
    const next = jest.fn();

    trustedForwardedIp(req, {}, next);

    expect(req.ip).toBe('162.158.63.169');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('does not throw when secret lengths differ (constant-time compare guard)', () => {
    const req = makeReq({
      'x-internal-service-secret': 'short',
      'x-forwarded-visitor-ip': '203.0.113.7',
    });
    const next = jest.fn();

    expect(() => trustedForwardedIp(req, {}, next)).not.toThrow();
    expect(req.ip).toBe('162.158.63.169');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
