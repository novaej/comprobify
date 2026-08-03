jest.mock('../../../instrument', () => ({ captureMessage: jest.fn() }));
jest.mock('../../../src/services/redis.service');

const Sentry = require('../../../instrument');
const redisService = require('../../../src/services/redis.service');
const config = require('../../../src/config');
const attemptTrackerService = require('../../../src/services/attempt-tracker.service');

describe('attempt-tracker.service', () => {
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('returns false without touching Redis when no client is configured', async () => {
    redisService.getClient.mockReturnValue(null);

    const result = await attemptTrackerService.recordEvent('SOME_EVENT', 'some-key');

    expect(result).toBe(false);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  test('sets an expiry only on the first increment for a key', async () => {
    const client = { incr: jest.fn().mockResolvedValue(1), pexpire: jest.fn().mockResolvedValue(1) };
    redisService.getClient.mockReturnValue(client);

    await attemptTrackerService.recordEvent('SOME_EVENT', 'some-key');

    expect(client.incr).toHaveBeenCalledWith('attempt:SOME_EVENT:some-key');
    expect(client.pexpire).toHaveBeenCalledWith('attempt:SOME_EVENT:some-key', config.attemptTracker.windowMs);
  });

  test('does not reset the expiry on subsequent increments', async () => {
    const client = { incr: jest.fn().mockResolvedValue(2), pexpire: jest.fn().mockResolvedValue(1) };
    redisService.getClient.mockReturnValue(client);

    await attemptTrackerService.recordEvent('SOME_EVENT', 'some-key');

    expect(client.pexpire).not.toHaveBeenCalled();
  });

  test('returns false below the configured threshold', async () => {
    const client = { incr: jest.fn().mockResolvedValue(config.attemptTracker.threshold - 1), pexpire: jest.fn() };
    redisService.getClient.mockReturnValue(client);

    const result = await attemptTrackerService.recordEvent('SOME_EVENT', 'some-key');

    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  test('returns true and logs exactly once at the exact threshold-crossing count', async () => {
    const client = { incr: jest.fn().mockResolvedValue(config.attemptTracker.threshold), pexpire: jest.fn() };
    redisService.getClient.mockReturnValue(client);

    const result = await attemptTrackerService.recordEvent('ADMIN_AUTH_FAILURE', '1.2.3.4');

    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('ADMIN_AUTH_FAILURE');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('ADMIN_AUTH_FAILURE'),
      expect.objectContaining({
        level: 'warning',
        tags: { eventType: 'ADMIN_AUTH_FAILURE' },
        extra: { key: '1.2.3.4', count: config.attemptTracker.threshold },
      })
    );
  });

  test('returns true but does not re-log on counts past the threshold', async () => {
    const client = { incr: jest.fn().mockResolvedValue(config.attemptTracker.threshold + 3), pexpire: jest.fn() };
    redisService.getClient.mockReturnValue(client);

    const result = await attemptTrackerService.recordEvent('SOME_EVENT', 'some-key');

    expect(result).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  test('fails open and returns false when the Redis call rejects', async () => {
    const client = { incr: jest.fn().mockRejectedValue(new Error('connection lost')), pexpire: jest.fn() };
    redisService.getClient.mockReturnValue(client);

    const result = await attemptTrackerService.recordEvent('SOME_EVENT', 'some-key');

    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
