/**
 * certificate.service.js parses raw P12/PKCS#12 buffers directly with node-forge — it has no
 * model dependency. Building real, valid P12 fixtures that exercise every branch (the
 * BANCO CENTRAL vs SECURITY DATA friendly-name switch, the multi-cert-bag friendlyName lookup
 * at index [1], the extensions-length reduce to pick the leaf cert, the two shapes of private
 * key bag) would require hand-crafting ASN.1 structures node-forge's own public helpers don't
 * expose. Instead we automock `node-forge` itself: Jest's automocker replaces every exported
 * function with a jest.fn() while preserving plain data (the `forge.pki.oids.*` / `forge.oids.*`
 * string constants the source code keys objects with), so we can drive each branch by
 * controlling the mocked return values while still exercising the service's real control flow.
 */
jest.mock('node-forge');

const forge = require('node-forge');
const certificateService = require('../../../src/services/certificate.service');

function makeCertBag(extensionsCount, notBefore, notAfter, friendlyName) {
  return {
    cert: {
      extensions: new Array(extensionsCount).fill({}),
      validity: { notBefore, notAfter },
    },
    attributes: friendlyName ? { friendlyName: [friendlyName] } : {},
  };
}

function makeKeyBag({ friendlyName, key, asn1 } = {}) {
  return {
    attributes: friendlyName ? { friendlyName: [friendlyName] } : {},
    key,
    asn1,
  };
}

function mockP12({ certBags, keyBags }) {
  const p12 = { getBags: jest.fn() };
  p12.getBags.mockImplementation((filter) => {
    if (filter.bagType === forge.pki.oids.pkcs8ShroudedKeyBag) {
      return { [forge.oids.pkcs8ShroudedKeyBag]: keyBags };
    }
    if (filter.bagType === forge.pki.oids.certBag) {
      return { [forge.oids.certBag]: certBags };
    }
    return {};
  });
  return p12;
}

describe('CertificateService', () => {
  const VALID_FROM = new Date('2020-01-01T00:00:00Z');
  const VALID_TO = new Date('2099-01-01T00:00:00Z');

  beforeEach(() => {
    forge.asn1.fromDer.mockReturnValue('p12Asn1');
    forge.pki.certificateToPem.mockReturnValue('CERT_PEM');
    forge.pki.privateKeyToPem.mockReturnValue('KEY_PEM');
    forge.pki.certificateToAsn1.mockReturnValue('certAsn1');
    forge.asn1.toDer.mockReturnValue({ getBytes: () => 'der-bytes' });
    forge.md.sha256.create.mockReturnValue({
      update: jest.fn(),
      digest: () => ({ toHex: () => 'deadbeef' }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('parseCertificate', () => {
    test('throws CERTIFICATE_INVALID when the buffer is not valid DER', () => {
      forge.asn1.fromDer.mockImplementation(() => {
        throw new Error('bad der');
      });

      expect(() => certificateService.parseCertificate(Buffer.from('junk'), 'pw'))
        .toThrow(expect.objectContaining({ statusCode: 400, code: 'CERTIFICATE_INVALID' }));
    });

    test('throws CERTIFICATE_PASSWORD_INVALID when the P12 password is wrong', () => {
      forge.pkcs12.pkcs12FromAsn1.mockImplementation(() => {
        throw new Error('bad password');
      });

      expect(() => certificateService.parseCertificate(Buffer.from('junk'), 'wrong-pw'))
        .toThrow(expect.objectContaining({ statusCode: 400, code: 'CERTIFICATE_PASSWORD_INVALID' }));
    });

    test('throws CERTIFICATE_KEY_NOT_FOUND when the friendly name is neither BANCO CENTRAL nor SECURITY DATA', () => {
      const certBags = [
        makeCertBag(1, VALID_FROM, VALID_TO),
        makeCertBag(2, VALID_FROM, VALID_TO, 'SOME OTHER CA'),
      ];
      forge.pkcs12.pkcs12FromAsn1.mockReturnValue(mockP12({ certBags, keyBags: [] }));

      expect(() => certificateService.parseCertificate(Buffer.from('junk'), 'pw'))
        .toThrow(expect.objectContaining({ statusCode: 400, code: 'CERTIFICATE_KEY_NOT_FOUND' }));
    });

    test('throws CERTIFICATE_KEY_NOT_FOUND for a BANCO CENTRAL cert with no matching Signing Key bag', () => {
      const certBags = [
        makeCertBag(1, VALID_FROM, VALID_TO),
        makeCertBag(2, VALID_FROM, VALID_TO, 'BANCO CENTRAL DEL ECUADOR'),
      ];
      const keyBags = [
        makeKeyBag({ friendlyName: 'Encryption Key', key: 'privKey' }),
      ];
      forge.pkcs12.pkcs12FromAsn1.mockReturnValue(mockP12({ certBags, keyBags }));

      expect(() => certificateService.parseCertificate(Buffer.from('junk'), 'pw'))
        .toThrow(expect.objectContaining({ statusCode: 400, code: 'CERTIFICATE_KEY_NOT_FOUND' }));
    });

    test('throws CERTIFICATE_EXPIRED when now is outside the certificate validity window', () => {
      const past = new Date('2000-01-01T00:00:00Z');
      const alsoPast = new Date('2001-01-01T00:00:00Z');
      const certBags = [
        makeCertBag(1, past, alsoPast),
        makeCertBag(2, past, alsoPast, 'SECURITY DATA S.A.'),
      ];
      const keyBags = [makeKeyBag({ key: 'privKey' })];
      forge.pkcs12.pkcs12FromAsn1.mockReturnValue(mockP12({ certBags, keyBags }));

      expect(() => certificateService.parseCertificate(Buffer.from('junk'), 'pw'))
        .toThrow(expect.objectContaining({ statusCode: 400, code: 'CERTIFICATE_EXPIRED' }));
    });

    test('throws CERTIFICATE_EXPIRED when the certificate is not valid yet', () => {
      const future = new Date('2099-01-01T00:00:00Z');
      const evenLater = new Date('2100-01-01T00:00:00Z');
      const certBags = [
        makeCertBag(1, future, evenLater),
        makeCertBag(2, future, evenLater, 'SECURITY DATA S.A.'),
      ];
      const keyBags = [makeKeyBag({ key: 'privKey' })];
      forge.pkcs12.pkcs12FromAsn1.mockReturnValue(mockP12({ certBags, keyBags }));

      expect(() => certificateService.parseCertificate(Buffer.from('junk'), 'pw'))
        .toThrow(expect.objectContaining({ statusCode: 400, code: 'CERTIFICATE_EXPIRED' }));
    });

    test('parses a SECURITY DATA certificate, picking the cert bag with the most extensions as the leaf cert', () => {
      const leafCert = makeCertBag(5, VALID_FROM, VALID_TO); // most extensions -> the signing cert
      const caCert = makeCertBag(2, VALID_FROM, VALID_TO, 'SECURITY DATA S.A.');
      const keyBags = [makeKeyBag({ key: 'privKeyObject' })];
      forge.pkcs12.pkcs12FromAsn1.mockReturnValue(mockP12({ certBags: [leafCert, caCert], keyBags }));

      const result = certificateService.parseCertificate(Buffer.from('junk'), 'pw');

      expect(forge.pki.privateKeyToPem).toHaveBeenCalledWith('privKeyObject');
      expect(forge.pki.certificateToPem).toHaveBeenCalledWith(leafCert.cert);
      expect(forge.pki.privateKeyFromAsn1).not.toHaveBeenCalled();
      expect(result).toEqual({
        privateKeyPem: 'KEY_PEM',
        certPem: 'CERT_PEM',
        certExpiry: VALID_TO,
        certFingerprint: 'deadbeef',
      });
    });

    test('derives the private key from ASN.1 when the key bag exposes asn1 instead of a parsed key', () => {
      const certBags = [
        makeCertBag(1, VALID_FROM, VALID_TO),
        makeCertBag(2, VALID_FROM, VALID_TO, 'SECURITY DATA S.A.'),
      ];
      const keyBags = [makeKeyBag({ asn1: 'keyAsn1' })];
      forge.pkcs12.pkcs12FromAsn1.mockReturnValue(mockP12({ certBags, keyBags }));
      forge.pki.privateKeyFromAsn1.mockReturnValue('derivedPrivateKey');

      const result = certificateService.parseCertificate(Buffer.from('junk'), 'pw');

      expect(forge.pki.privateKeyFromAsn1).toHaveBeenCalledWith('keyAsn1');
      expect(forge.pki.privateKeyToPem).toHaveBeenCalledWith('derivedPrivateKey');
      expect(result.privateKeyPem).toBe('KEY_PEM');
    });

    test('parses a BANCO CENTRAL certificate by locating the Signing Key bag among several keys', () => {
      const certBags = [
        makeCertBag(1, VALID_FROM, VALID_TO),
        makeCertBag(2, VALID_FROM, VALID_TO, 'BANCO CENTRAL DEL ECUADOR'),
      ];
      const keyBags = [
        makeKeyBag({ friendlyName: 'Encryption Key', key: 'encryptionKey' }),
        makeKeyBag({ friendlyName: 'Signing Key', key: 'signingKey' }),
      ];
      forge.pkcs12.pkcs12FromAsn1.mockReturnValue(mockP12({ certBags, keyBags }));

      const result = certificateService.parseCertificate(Buffer.from('junk'), 'pw');

      expect(forge.pki.privateKeyToPem).toHaveBeenCalledWith('signingKey');
      expect(result.privateKeyPem).toBe('KEY_PEM');
    });

    test('computes the certificate fingerprint as the sha256 hex digest of the DER-encoded cert', () => {
      // certBags[0] has more extensions than certBags[1], so the reduce() in the service picks
      // certBags[0] as the leaf/signing cert even though the friendly name lives on certBags[1].
      const certBags = [
        makeCertBag(3, VALID_FROM, VALID_TO),
        makeCertBag(1, VALID_FROM, VALID_TO, 'SECURITY DATA S.A.'),
      ];
      const keyBags = [makeKeyBag({ key: 'privKeyObject' })];
      forge.pkcs12.pkcs12FromAsn1.mockReturnValue(mockP12({ certBags, keyBags }));
      const mdUpdate = jest.fn();
      forge.md.sha256.create.mockReturnValue({
        update: mdUpdate,
        digest: () => ({ toHex: () => 'fingerprint123' }),
      });

      const result = certificateService.parseCertificate(Buffer.from('junk'), 'pw');

      expect(forge.pki.certificateToAsn1).toHaveBeenCalledWith(certBags[0].cert);
      expect(forge.asn1.toDer).toHaveBeenCalledWith('certAsn1');
      expect(mdUpdate).toHaveBeenCalledWith('der-bytes');
      expect(result.certFingerprint).toBe('fingerprint123');
    });
  });
});
