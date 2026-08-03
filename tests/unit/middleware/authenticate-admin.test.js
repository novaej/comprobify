process.env.ADMIN_SECRET = 'correct-secret';

jest.mock('../../../src/services/attempt-tracker.service');

const attemptTrackerService = require('../../../src/services/attempt-tracker.service');
const AttemptEventTypes = require('../../../src/constants/attempt-event-types');
const authenticateAdmin = require('../../../src/middleware/authenticate-admin');

function makeReq(authHeader, ip) {
  return { headers: authHeader !== undefined ? { authorization: authHeader } : {}, ip: ip || '1.2.3.4' };
}

function runMiddleware(req) {
  return new Promise((resolve, reject) => {
    authenticateAdmin(req, {}, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe('authenticateAdmin middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls next() with no error when the secret matches', async () => {
    const req = makeReq('Bearer correct-secret');
    await expect(runMiddleware(req)).resolves.toBeUndefined();
    expect(attemptTrackerService.recordEvent).not.toHaveBeenCalled();
  });

  test('passes 401 when Authorization header is missing', async () => {
    const req = makeReq(undefined);
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('passes 401 when Authorization header does not start with Bearer', async () => {
    const req = makeReq('Basic abc123');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('passes 401 when token is empty', async () => {
    const req = makeReq('Bearer ');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('passes 401 when the secret does not match', async () => {
    const req = makeReq('Bearer wrong-secret');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  test('records an ADMIN_AUTH_FAILURE attempt keyed by IP when the secret does not match', async () => {
    const req = makeReq('Bearer wrong-secret', '9.9.9.9');
    await expect(runMiddleware(req)).rejects.toMatchObject({ statusCode: 401 });
    expect(attemptTrackerService.recordEvent).toHaveBeenCalledWith(AttemptEventTypes.ADMIN_AUTH_FAILURE, '9.9.9.9');
  });
});
