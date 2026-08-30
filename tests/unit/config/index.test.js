describe('config/index.js db.ssl', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('is false when DB_SSL is not "true"', () => {
    delete process.env.DB_SSL;
    const config = require('../../../src/config/index');
    expect(config.db.ssl).toBe(false);
  });

  it('has no ca option when DB_SSL_CA is unset', () => {
    process.env.DB_SSL = 'true';
    delete process.env.DB_SSL_CA;
    const config = require('../../../src/config/index');
    expect(config.db.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('converts literal \\n sequences in DB_SSL_CA into real newlines', () => {
    process.env.DB_SSL = 'true';
    process.env.DB_SSL_CA = '-----BEGIN CERTIFICATE-----\\nMIIE+AB\\n-----END CERTIFICATE-----';
    const config = require('../../../src/config/index');
    expect(config.db.ssl.ca).toBe(
      '-----BEGIN CERTIFICATE-----\nMIIE+AB\n-----END CERTIFICATE-----'
    );
  });

  it('leaves DB_SSL_CA content with real newlines unchanged', () => {
    process.env.DB_SSL = 'true';
    process.env.DB_SSL_CA = '-----BEGIN CERTIFICATE-----\nMIIE+AB\n-----END CERTIFICATE-----';
    const config = require('../../../src/config/index');
    expect(config.db.ssl.ca).toBe(
      '-----BEGIN CERTIFICATE-----\nMIIE+AB\n-----END CERTIFICATE-----'
    );
  });
});

describe('config/index.js payphone', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // Optional by design: unset means the card-payment endpoints 503 and the
  // manual SPI flow is untouched, so a vendor outage can't take billing down.
  it('defaults to empty credentials so card payments simply stay unavailable', () => {
    delete process.env.PAYPHONE_TOKEN;
    delete process.env.PAYPHONE_STORE_ID;
    const config = require('../../../src/config/index');
    expect(config.payphone.token).toBe('');
    expect(config.payphone.storeId).toBe('');
  });

  it('defaults the API base URL and confirm timeout', () => {
    delete process.env.PAYPHONE_API_BASE_URL;
    delete process.env.PAYPHONE_CONFIRM_TIMEOUT_MS;
    const config = require('../../../src/config/index');
    expect(config.payphone.apiBaseUrl).toBe('https://paymentbox.payphonetodoesposible.com');
    expect(config.payphone.confirmTimeoutMs).toBe(10000);
  });

  it('reads credentials, base URL and timeout from the environment', () => {
    process.env.PAYPHONE_TOKEN = 'tok';
    process.env.PAYPHONE_STORE_ID = 'store';
    process.env.PAYPHONE_API_BASE_URL = 'https://sandbox.payphone.test';
    process.env.PAYPHONE_CONFIRM_TIMEOUT_MS = '2500';
    const config = require('../../../src/config/index');
    expect(config.payphone).toMatchObject({
      token: 'tok', storeId: 'store', apiBaseUrl: 'https://sandbox.payphone.test', confirmTimeoutMs: 2500,
    });
  });

  it('falls back to the default timeout when the env var is not a number', () => {
    process.env.PAYPHONE_CONFIRM_TIMEOUT_MS = 'soon';
    const config = require('../../../src/config/index');
    expect(config.payphone.confirmTimeoutMs).toBe(10000);
  });
});
