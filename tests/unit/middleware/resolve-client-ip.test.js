const resolveClientIp = require('../../../src/middleware/resolve-client-ip');

describe('resolveClientIp middleware', () => {
  test('overrides req.ip when X-Real-Client-IP is present', () => {
    const req = { headers: { 'x-real-client-ip': '203.0.113.7' }, ip: '162.158.63.169' };
    const next = jest.fn();

    resolveClientIp(req, {}, next);

    expect(req.ip).toBe('203.0.113.7');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('leaves req.ip untouched when the header is absent', () => {
    const req = { headers: {}, ip: '127.0.0.1' };
    const next = jest.fn();

    resolveClientIp(req, {}, next);

    expect(req.ip).toBe('127.0.0.1');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('the overridden req.ip stays reassignable (configurable)', () => {
    const req = { headers: { 'x-real-client-ip': '203.0.113.7' }, ip: '162.158.63.169' };

    resolveClientIp(req, {}, jest.fn());
    req.ip = '198.51.100.1';

    expect(req.ip).toBe('198.51.100.1');
  });
});
