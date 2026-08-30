const config = require('../../../src/config');
const payphoneService = require('../../../src/services/payphone.service');

const originalPayphone = { ...config.payphone };

describe('payphoneService', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    config.payphone.token = 'test-token';
    config.payphone.storeId = 'test-store';
    config.payphone.apiBaseUrl = 'https://payphone.test';
    config.payphone.confirmTimeoutMs = 50;
  });

  afterEach(() => {
    Object.assign(config.payphone, originalPayphone);
    jest.clearAllMocks();
  });

  describe('isConfigured', () => {
    test('needs both a token and a store id', () => {
      expect(payphoneService.isConfigured()).toBe(true);

      config.payphone.token = '';
      expect(payphoneService.isConfigured()).toBe(false);

      config.payphone.token = 'test-token';
      config.payphone.storeId = '';
      expect(payphoneService.isConfigured()).toBe(false);
    });
  });

  describe('confirm', () => {
    test('posts the bearer token and both ids to /api/confirm', async () => {
      global.fetch.mockResolvedValue({
        ok: true, status: 200, text: async () => JSON.stringify({ statusCode: 3, amount: 2000 }),
      });

      await payphoneService.confirm({ id: 123, clientTxId: 'abc' });

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('https://payphone.test/api/confirm');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-token');
      expect(JSON.parse(options.body)).toEqual({ id: 123, clientTxId: 'abc' });
    });

    test('parses the JSON body on success', async () => {
      global.fetch.mockResolvedValue({
        ok: true, status: 200, text: async () => JSON.stringify({ statusCode: 3, amount: 2000 }),
      });

      const result = await payphoneService.confirm({ id: 1, clientTxId: 'a' });

      expect(result).toMatchObject({ ok: true, statusCode: 200, body: { statusCode: 3, amount: 2000 } });
    });

    // A declined charge is a 200 with statusCode 2, but Payphone also returns
    // JSON on errors — the caller needs the body either way to record it.
    test('returns ok:false with the parsed body on a non-2xx, NOT an error', async () => {
      global.fetch.mockResolvedValue({
        ok: false, status: 400, text: async () => JSON.stringify({ message: 'Transaction not found', errorCode: 20 }),
      });

      const result = await payphoneService.confirm({ id: 1, clientTxId: 'a' });

      expect(result.ok).toBe(false);
      expect(result.error).toBeUndefined(); // not a transport failure
      expect(result.body).toEqual({ message: 'Transaction not found', errorCode: 20 });
    });

    test('an unparseable body is not treated as a transport failure', async () => {
      global.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '<html>oops</html>' });

      const result = await payphoneService.confirm({ id: 1, clientTxId: 'a' });

      expect(result.ok).toBe(true);
      expect(result.body).toBeNull();
      expect(result.error).toBeUndefined();
      expect(result.raw).toBe('<html>oops</html>');
    });

    // The contract the whole confirm flow depends on: a transport failure must
    // be distinguishable from a decline, or an unresolved charge gets treated
    // as declined and real money is stranded.
    test('never throws on a network failure — returns ok:false WITH an error', async () => {
      global.fetch.mockRejectedValue(new Error('ECONNRESET'));

      const result = await payphoneService.confirm({ id: 1, clientTxId: 'a' });

      expect(result).toEqual({ ok: false, error: 'ECONNRESET' });
    });

    test('never throws on a timeout', async () => {
      global.fetch.mockImplementation((_url, opts) => new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
      }));

      const result = await payphoneService.confirm({ id: 1, clientTxId: 'a' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('abort');
    });

    test('passes an abort signal so the timeout can fire', async () => {
      global.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

      await payphoneService.confirm({ id: 1, clientTxId: 'a' });

      expect(global.fetch.mock.calls[0][1].signal).toBeDefined();
    });
  });

  describe('sanitizeConfirmResponse', () => {
    // Payphone returns payer identity fields we have no use for; retaining them
    // indefinitely is what this filter exists to prevent.
    test('drops the payer email, phone, cedula and free-form parameter', () => {
      const out = payphoneService.sanitizeConfirmResponse({
        statusCode: 3,
        amount: 2000,
        email: 'payer@example.com',
        phoneNumber: '0991234567',
        document: '1712345678',
        optionalParameter: 'anything at all',
        bin: '424242',
      });

      expect(out).toEqual({ statusCode: 3, amount: 2000 });
    });

    test('keeps the money, status and card-metadata fields we actually use', () => {
      const body = {
        transactionId: 99, statusCode: 3, transactionStatus: 'Approved',
        authorizationCode: 'A1', amount: 2000, tax: 260, currency: 'USD',
        cardBrand: 'Visa', lastDigits: '4242', message: 'ok', errorCode: 0,
      };

      expect(payphoneService.sanitizeConfirmResponse(body)).toEqual(body);
    });

    // An unknown field is dropped rather than kept: a new PII field on their
    // side must not start being persisted silently.
    test('drops fields it does not know about', () => {
      const out = payphoneService.sanitizeConfirmResponse({ statusCode: 3, somethingNew: 'x' });

      expect(out).toEqual({ statusCode: 3 });
    });

    test('passes through null and non-objects untouched', () => {
      expect(payphoneService.sanitizeConfirmResponse(null)).toBeNull();
      expect(payphoneService.sanitizeConfirmResponse(undefined)).toBeNull();
    });

    test('confirm applies it, so no consumer ever sees the payer fields', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ statusCode: 3, amount: 2000, email: 'p@example.com' }),
      });

      const result = await payphoneService.confirm({ id: 1, clientTxId: 'a' });

      expect(result.body).toEqual({ statusCode: 3, amount: 2000 });
    });
  });
});
