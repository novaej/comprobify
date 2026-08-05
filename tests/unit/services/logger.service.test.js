const mockConsoleTransport = { type: 'console' };
const mockLogtailTransport = { type: 'logtail' };
const mockCreateLogger = jest.fn().mockReturnValue({ info: jest.fn(), error: jest.fn() });
const mockLogtailConstructor = jest.fn();
const mockConsoleTransportConstructor = jest.fn();

jest.mock('winston', () => ({
  createLogger: (...args) => mockCreateLogger(...args),
  format: {
    json: jest.fn().mockReturnValue('json-format'),
    printf: jest.fn().mockReturnValue('printf-format'),
  },
  transports: {
    Console: jest.fn().mockImplementation((...args) => {
      mockConsoleTransportConstructor(...args);
      return mockConsoleTransport;
    }),
  },
}));
jest.mock('@logtail/node', () => ({
  Logtail: jest.fn().mockImplementation((...args) => {
    mockLogtailConstructor(...args);
    return { type: 'logtail-client' };
  }),
}));
jest.mock('@logtail/winston', () => ({
  LogtailTransport: jest.fn().mockImplementation(() => mockLogtailTransport),
}));
jest.mock('os', () => ({
  hostname: jest.fn().mockReturnValue('test-host'),
}));

describe('logger.service', () => {
  beforeEach(() => {
    jest.resetModules();
    mockCreateLogger.mockClear();
    mockLogtailConstructor.mockClear();
    mockConsoleTransportConstructor.mockClear();
  });

  test('only the Console transport is used when BETTERSTACK_SOURCE_TOKEN is not configured', () => {
    const config = require('../../../src/config');
    config.logging.betterstackSourceToken = '';
    require('../../../src/services/logger.service');

    expect(mockCreateLogger).toHaveBeenCalledWith(
      expect.objectContaining({ transports: [mockConsoleTransport] })
    );
    expect(mockLogtailConstructor).not.toHaveBeenCalled();
  });

  test('adds the Logtail transport when BETTERSTACK_SOURCE_TOKEN is configured, using the library default endpoint when no ingesting host is set', () => {
    const config = require('../../../src/config');
    config.logging.betterstackSourceToken = 'a-source-token';
    config.logging.betterstackIngestingHost = '';
    require('../../../src/services/logger.service');

    expect(mockLogtailConstructor).toHaveBeenCalledWith('a-source-token', undefined);
    expect(mockCreateLogger).toHaveBeenCalledWith(
      expect.objectContaining({ transports: [mockConsoleTransport, mockLogtailTransport] })
    );
  });

  test('passes the configured ingesting host as the endpoint override when set', () => {
    const config = require('../../../src/config');
    config.logging.betterstackSourceToken = 'a-source-token';
    config.logging.betterstackIngestingHost = 'https://s123456.eu-central-1a.betterstackdata.com';
    require('../../../src/services/logger.service');

    expect(mockLogtailConstructor).toHaveBeenCalledWith(
      'a-source-token',
      { endpoint: 'https://s123456.eu-central-1a.betterstackdata.com' }
    );
  });

  test('the Console transport gets its own human-readable format, distinct from the JSON default', () => {
    const winston = require('winston');
    require('../../../src/services/logger.service');

    // Console transport is constructed with a `format` option (the printf
    // one) — it must not fall through to the logger-level JSON default,
    // which is what the shipped (Logtail) transport still uses.
    expect(mockConsoleTransportConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'printf-format' })
    );
    expect(mockCreateLogger).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'json-format' })
    );
    expect(winston.format.printf).toHaveBeenCalled();
  });

  test('the console format function prefixes the uppercased level and preserves every other field as JSON', () => {
    const winston = require('winston');
    require('../../../src/services/logger.service');

    const formatFn = winston.format.printf.mock.calls[0][0];
    const line = formatFn({ level: 'info', message: 'GET /health 200', requestId: 'req-1', statusCode: 200 });

    expect(line).toBe('INFO: {"message":"GET /health 200","requestId":"req-1","statusCode":200}');
  });

  test('sets defaultMeta.hostname from os.hostname(), so every log entry carries it regardless of which consumer logs', () => {
    require('../../../src/services/logger.service');

    expect(mockCreateLogger).toHaveBeenCalledWith(
      expect.objectContaining({ defaultMeta: { hostname: 'test-host' } })
    );
  });
});
