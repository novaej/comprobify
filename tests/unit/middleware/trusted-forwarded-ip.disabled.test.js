delete process.env.INTERNAL_SERVICE_SECRET;

const trustedForwardedIp = require('../../../src/middleware/trusted-forwarded-ip');

describe('trustedForwardedIp middleware (INTERNAL_SERVICE_SECRET unset)', () => {
  test('leaves req.ip untouched even with matching-looking headers, since the feature is inactive', () => {
    const req = {
      headers: { 'x-internal-service-secret': 'anything', 'x-forwarded-visitor-ip': '203.0.113.7' },
      ip: '162.158.63.169',
    };
    const next = jest.fn();

    trustedForwardedIp(req, {}, next);

    expect(req.ip).toBe('162.158.63.169');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
