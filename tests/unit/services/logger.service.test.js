const mockConsoleTransport = { type: 'console' };
const mockLogtailTransport = { type: 'logtail' };
const mockCreateLogger = jest.fn().mockReturnValue({ info: jest.fn(), error: jest.fn() });
const mockLogtailConstructor = jest.fn();

jest.mock('winston', () => ({
  createLogger: (...args) => mockCreateLogger(...args),
  format: { json: jest.fn().mockReturnValue('json-format') },
  transports: { Console: jest.fn().mockImplementation(() => mockConsoleTransport) },
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

describe('logger.service', () => {
  beforeEach(() => {
    jest.resetModules();
    mockCreateLogger.mockClear();
    mockLogtailConstructor.mockClear();
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

  test('adds the Logtail transport when BETTERSTACK_SOURCE_TOKEN is configured', () => {
    const config = require('../../../src/config');
    config.logging.betterstackSourceToken = 'a-source-token';
    require('../../../src/services/logger.service');

    expect(mockLogtailConstructor).toHaveBeenCalledWith('a-source-token');
    expect(mockCreateLogger).toHaveBeenCalledWith(
      expect.objectContaining({ transports: [mockConsoleTransport, mockLogtailTransport] })
    );
  });
});
