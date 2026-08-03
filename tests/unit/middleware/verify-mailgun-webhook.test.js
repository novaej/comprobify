process.env.MAILGUN_WEBHOOK_SIGNING_KEY = 'signing-key';

jest.mock('../../../src/services/attempt-tracker.service');

const crypto = require('crypto');
const attemptTrackerService = require('../../../src/services/attempt-tracker.service');
const AttemptEventTypes = require('../../../src/constants/attempt-event-types');
const verifyMailgunWebhook = require('../../../src/middleware/verify-mailgun-webhook');

function sign(timestamp, token, signingKey = 'signing-key') {
  return crypto.createHmac('sha256', signingKey).update(timestamp + token).digest('hex');
}

function makeReq(body, ip) {
  return { body, ip: ip || '1.2.3.4' };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('verifyMailgunWebhook middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls next() when the signature is valid', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = 'tok';
    const req = makeReq({ signature: { timestamp, token, signature: sign(timestamp, token) } });
    const res = makeRes();
    const next = jest.fn();

    verifyMailgunWebhook(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(attemptTrackerService.recordEvent).not.toHaveBeenCalled();
  });

  test('returns 401 when signature fields are missing', () => {
    const req = makeReq({});
    const res = makeRes();
    verifyMailgunWebhook(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(attemptTrackerService.recordEvent).not.toHaveBeenCalled();
  });

  test('returns 401 when the timestamp is stale', () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);
    const token = 'tok';
    const req = makeReq({ signature: { timestamp, token, signature: sign(timestamp, token) } });
    const res = makeRes();
    verifyMailgunWebhook(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(attemptTrackerService.recordEvent).not.toHaveBeenCalled();
  });

  test('returns 401 and records a MAILGUN_WEBHOOK_INVALID_SIGNATURE attempt when the signature does not match', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = 'tok';
    const req = makeReq({ signature: { timestamp, token, signature: sign(timestamp, token, 'wrong-key') } }, '9.9.9.9');
    const res = makeRes();

    verifyMailgunWebhook(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(attemptTrackerService.recordEvent).toHaveBeenCalledWith(AttemptEventTypes.MAILGUN_WEBHOOK_INVALID_SIGNATURE, '9.9.9.9');
  });
});
