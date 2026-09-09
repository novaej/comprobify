process.env.INTERNAL_SERVICE_SECRET = 'correct-secret';

jest.mock('../../../src/services/attempt-tracker.service');

const attemptTrackerService = require('../../../src/services/attempt-tracker.service');
const AttemptEventTypes = require('../../../src/constants/attempt-event-types');
const requireInternalService = require('../../../src/middleware/require-internal-service');

function makeReq(headers, ip) {
  return { headers, ip: ip || '1.2.3.4' };
}

function runMiddleware(req) {
  return new Promise((resolve, reject) => {
    requireInternalService(req, {}, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe('requireInternalService middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls next() with no error when the secret matches', async () => {
    const req = makeReq({ 'x-internal-service-secret': 'correct-secret' });
    await expect(runMiddleware(req)).resolves.toBeUndefined();
    expect(attemptTrackerService.recordEvent).not.toHaveBeenCalled();
  });

  test('rejects with 403 INTERNAL_SERVICE_ONLY when the header is missing entirely', async () => {
    const req = makeReq({});
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 403, code: 'INTERNAL_SERVICE_ONLY' });
  });

  test('does not record an attempt when the header is simply absent (avoids noise from random scanners)', async () => {
    const req = makeReq({});
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 403 });
    expect(attemptTrackerService.recordEvent).not.toHaveBeenCalled();
  });

  test('rejects with 403 when the secret does not match', async () => {
    const req = makeReq({ 'x-internal-service-secret': 'wrong-secret' });
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 403, code: 'INTERNAL_SERVICE_ONLY' });
  });

  test('records an INTERNAL_SERVICE_AUTH_FAILURE attempt keyed by IP when a wrong secret is presented', async () => {
    const req = makeReq({ 'x-internal-service-secret': 'wrong-secret' }, '9.9.9.9');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 403 });
    expect(attemptTrackerService.recordEvent).toHaveBeenCalledWith(AttemptEventTypes.INTERNAL_SERVICE_AUTH_FAILURE, '9.9.9.9');
  });

  test('does not throw when secret lengths differ (constant-time compare guard)', async () => {
    const req = makeReq({ 'x-internal-service-secret': 'short' });
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 403 });
  });
});
