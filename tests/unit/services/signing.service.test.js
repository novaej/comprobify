jest.mock('../../../helpers/firmar');
jest.mock('../../../src/services/crypto.service');

const { sign } = require('../../../helpers/firmar');
const cryptoService = require('../../../src/services/crypto.service');
const signingService = require('../../../src/services/signing.service');

describe('SigningService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('decrypts cert password and calls sign with correct args', () => {
    cryptoService.decrypt.mockReturnValue('plain-password');
    sign.mockReturnValue('<signed-xml/>');

    const result = signingService.signXml('<xml/>', 'cert/token.p12', 'encrypted-pwd');

    expect(cryptoService.decrypt).toHaveBeenCalledWith('encrypted-pwd');
    expect(sign).toHaveBeenCalledWith('cert/token.p12', 'plain-password', '<xml/>');
    expect(result).toBe('<signed-xml/>');
  });

  test('throws when cert password is not provided', () => {
    expect(() => signingService.signXml('<xml/>', 'cert/token.p12', undefined))
      .toThrow('Certificate password not configured');
  });
});
