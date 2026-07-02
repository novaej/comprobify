const config = require('../../../src/config');
const sriService = require('../../../src/services/sri.service');

const ORIGINAL_APP_ENV = config.appEnv;

function mockFetchResponse({ ok = true, status = 200, body = '' }) {
  return { ok, status, text: async () => body };
}

describe('SriService', () => {
  let warnSpy;

  beforeEach(() => {
    global.fetch = jest.fn();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    warnSpy.mockRestore();
    config.appEnv = ORIGINAL_APP_ENV;
    jest.useRealTimers();
  });

  describe('sendReceipt', () => {
    test('posts the base64-encoded XML wrapped in the reception SOAP envelope', async () => {
      config.appEnv = 'staging';
      global.fetch.mockResolvedValue(mockFetchResponse({ body: '<estado>RECIBIDA</estado>' }));

      await sriService.sendReceipt('<factura/>', { sandbox: true });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(`${config.sri.testBaseUrl}/RecepcionComprobantesOffline?wsdl`);
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('text/xml; charset=utf-8');
      expect(options.body).toContain('<ec:validarComprobante>');
      expect(options.body).toContain(Buffer.from('<factura/>', 'utf8').toString('base64'));
    });

    test('parses the estado and an empty messages array when there is no mensajes block', async () => {
      config.appEnv = 'staging';
      global.fetch.mockResolvedValue(mockFetchResponse({ body: '<respuesta><estado>RECIBIDA</estado></respuesta>' }));

      const result = await sriService.sendReceipt('<factura/>', { sandbox: true });

      expect(result).toEqual({ status: 'RECIBIDA', messages: [], rawResponse: '<respuesta><estado>RECIBIDA</estado></respuesta>' });
    });

    test('parses multiple structured messages out of a mensajes block', async () => {
      config.appEnv = 'staging';
      const raw = `<respuesta><estado>DEVUELTA</estado><mensajes>
        <identificador>70</identificador><mensaje>EN PROCESAMIENTO</mensaje><informacionAdicional></informacionAdicional><tipo>ADVERTENCIA</tipo>
        <identificador>43</identificador><mensaje>ERROR X</mensaje><informacionAdicional>DETAIL</informacionAdicional><tipo>ERROR</tipo>
      </mensajes></respuesta>`;
      global.fetch.mockResolvedValue(mockFetchResponse({ body: raw }));

      const result = await sriService.sendReceipt('<factura/>', { sandbox: true });

      expect(result.status).toBe('DEVUELTA');
      expect(result.messages).toEqual([
        { identifier: '70', message: 'EN PROCESAMIENTO', additionalInfo: null, type: 'ADVERTENCIA' },
        { identifier: '43', message: 'ERROR X', additionalInfo: 'DETAIL', type: 'ERROR' },
      ]);
    });

    test('throws SriError on a non-ok HTTP response and does not retry', async () => {
      config.appEnv = 'staging';
      global.fetch.mockResolvedValue(mockFetchResponse({ ok: false, status: 500, body: 'server error' }));

      await expect(sriService.sendReceipt('<factura/>', { sandbox: true }))
        .rejects.toMatchObject({ statusCode: 502, code: 'SRI_SUBMISSION_FAILED' });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    describe('retry behavior (network failures only)', () => {
      beforeEach(() => {
        jest.useFakeTimers();
      });

      test('retries on fetch throws and succeeds once the network recovers', async () => {
        config.appEnv = 'staging';
        global.fetch
          .mockRejectedValueOnce(new Error('ECONNRESET'))
          .mockRejectedValueOnce(new Error('ECONNRESET'))
          .mockResolvedValueOnce(mockFetchResponse({ body: '<estado>RECIBIDA</estado>' }));

        const promise = sriService.sendReceipt('<factura/>', { sandbox: true });
        await jest.runAllTimersAsync();
        const result = await promise;

        expect(global.fetch).toHaveBeenCalledTimes(3);
        expect(result.status).toBe('RECIBIDA');
      });

      test('gives up and propagates the network error after exhausting retries (no SriError wrapping)', async () => {
        config.appEnv = 'staging';
        const networkErr = new Error('ETIMEDOUT');
        global.fetch.mockRejectedValue(networkErr);

        const promise = sriService.sendReceipt('<factura/>', { sandbox: true });
        promise.catch(() => {}); // avoid unhandled rejection warning before assertion below
        await jest.runAllTimersAsync();

        await expect(promise).rejects.toBe(networkErr);
        expect(global.fetch).toHaveBeenCalledTimes(3);
      });
    });

    test.each([
      ['staging', true, 'test'],
      ['staging', false, 'test'],
      ['production', true, 'test'],
      ['production', false, 'prod'],
    ])('routes to the %s base URL when appEnv=%s and issuer.sandbox=%s', async (appEnv, sandbox, expected) => {
      config.appEnv = appEnv;
      global.fetch.mockResolvedValue(mockFetchResponse({ body: '<estado>RECIBIDA</estado>' }));

      await sriService.sendReceipt('<factura/>', { sandbox });

      const expectedBase = expected === 'prod' ? config.sri.prodBaseUrl : config.sri.testBaseUrl;
      expect(global.fetch).toHaveBeenCalledWith(
        `${expectedBase}/RecepcionComprobantesOffline?wsdl`,
        expect.any(Object)
      );
    });
  });

  describe('checkAuthorization', () => {
    test('posts the access key wrapped in the authorization SOAP envelope', async () => {
      config.appEnv = 'staging';
      global.fetch.mockResolvedValue(mockFetchResponse({
        body: '<numeroComprobantes>1</numeroComprobantes><estado>AUTORIZADO</estado>',
      }));

      await sriService.checkAuthorization('1234567890', { sandbox: true });

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(`${config.sri.testBaseUrl}/AutorizacionComprobantesOffline?wsdl`);
      expect(options.body).toContain('<claveAccesoComprobante>1234567890</claveAccesoComprobante>');
    });

    test('routes to the production URL when appEnv=production and issuer.sandbox=false', async () => {
      config.appEnv = 'production';
      global.fetch.mockResolvedValue(mockFetchResponse({ body: '<numeroComprobantes>0</numeroComprobantes>' }));

      await sriService.checkAuthorization('1234567890', { sandbox: false });

      expect(global.fetch).toHaveBeenCalledWith(
        `${config.sri.prodBaseUrl}/AutorizacionComprobantesOffline?wsdl`,
        expect.any(Object)
      );
    });

    test('reports pending when numeroComprobantes is 0', async () => {
      config.appEnv = 'staging';
      global.fetch.mockResolvedValue(mockFetchResponse({ body: '<numeroComprobantes>0</numeroComprobantes>' }));

      const result = await sriService.checkAuthorization('1234567890', { sandbox: true });

      expect(result.pending).toBe(true);
    });

    test('parses a full AUTORIZADO response, unescaping the embedded comprobante XML', async () => {
      config.appEnv = 'staging';
      const raw = `<respuesta>
        <numeroComprobantes>1</numeroComprobantes>
        <estado>AUTORIZADO</estado>
        <numeroAutorizacion>AUTH-0001</numeroAutorizacion>
        <fechaAutorizacion>2026-01-02T10:00:00-05:00</fechaAutorizacion>
        <comprobante>&lt;factura&gt;A &amp; B &quot;quoted&quot; &apos;single&apos; &#65;&#x42;&lt;/factura&gt;</comprobante>
      </respuesta>`;
      global.fetch.mockResolvedValue(mockFetchResponse({ body: raw }));

      const result = await sriService.checkAuthorization('1234567890', { sandbox: true });

      expect(result).toMatchObject({
        pending: false,
        status: 'AUTORIZADO',
        authorizationNumber: 'AUTH-0001',
        authorizationDate: '2026-01-02T10:00:00-05:00',
        authorizationXml: '<factura>A & B "quoted" \'single\' AB</factura>',
      });
    });

    test('returns authorizationXml: null when there is no comprobante tag', async () => {
      config.appEnv = 'staging';
      global.fetch.mockResolvedValue(mockFetchResponse({
        body: '<numeroComprobantes>1</numeroComprobantes><estado>NO AUTORIZADO</estado>',
      }));

      const result = await sriService.checkAuthorization('1234567890', { sandbox: true });

      expect(result.authorizationXml).toBeNull();
      expect(result.status).toBe('NO AUTORIZADO');
    });

    test('parses messages on a rejected (NO AUTORIZADO) response', async () => {
      config.appEnv = 'staging';
      const raw = `<respuesta>
        <numeroComprobantes>1</numeroComprobantes>
        <estado>NO AUTORIZADO</estado>
        <mensajes>
          <identificador>43</identificador><mensaje>FIRMA INVALIDA</mensaje><informacionAdicional></informacionAdicional><tipo>ERROR</tipo>
        </mensajes>
      </respuesta>`;
      global.fetch.mockResolvedValue(mockFetchResponse({ body: raw }));

      const result = await sriService.checkAuthorization('1234567890', { sandbox: true });

      expect(result.messages).toEqual([
        { identifier: '43', message: 'FIRMA INVALIDA', additionalInfo: null, type: 'ERROR' },
      ]);
    });

    test('throws SriError on a non-ok HTTP response and does not retry', async () => {
      config.appEnv = 'staging';
      global.fetch.mockResolvedValue(mockFetchResponse({ ok: false, status: 503, body: 'unavailable' }));

      await expect(sriService.checkAuthorization('1234567890', { sandbox: true }))
        .rejects.toMatchObject({ statusCode: 502, code: 'SRI_SUBMISSION_FAILED' });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('retries on fetch throws and succeeds once the network recovers', async () => {
      jest.useFakeTimers();
      config.appEnv = 'staging';
      global.fetch
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce(mockFetchResponse({ body: '<numeroComprobantes>0</numeroComprobantes>' }));

      const promise = sriService.checkAuthorization('1234567890', { sandbox: true });
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.pending).toBe(true);
    });
  });
});
