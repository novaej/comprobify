jest.mock('../../../helpers/signer');
jest.mock('../../../src/services/crypto.service');

const { sign } = require('../../../helpers/signer');
const cryptoService = require('../../../src/services/crypto.service');
const signingService = require('../../../src/services/signing.service');

describe('SigningService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('decrypts private key and calls sign with correct args', () => {
    cryptoService.decrypt.mockReturnValue('-----BEGIN RSA PRIVATE KEY-----\nkey\n-----END RSA PRIVATE KEY-----');
    sign.mockReturnValue('<signed-xml/>');

    const result = signingService.signXml('<xml/>', 'encrypted-private-key', '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----');

    expect(cryptoService.decrypt).toHaveBeenCalledWith('encrypted-private-key');
    expect(sign).toHaveBeenCalledWith(
      '-----BEGIN RSA PRIVATE KEY-----\nkey\n-----END RSA PRIVATE KEY-----',
      '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----',
      '<xml/>'
    );
    expect(result).toBe('<signed-xml/>');
  });
});
