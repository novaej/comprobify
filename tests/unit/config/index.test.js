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
