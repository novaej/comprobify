const crypto = require('crypto');

const { encryptWithKey, decryptWithKey, parseKey } = require('../../../scripts/rotate-encryption-key');

describe('rotate-encryption-key', () => {
  const keyA = crypto.randomBytes(32);
  const keyB = crypto.randomBytes(32);

  describe('parseKey', () => {
    test('accepts a 64-char hex string', () => {
      const hex = crypto.randomBytes(32).toString('hex');
      expect(parseKey('TEST_KEY', hex)).toEqual(Buffer.from(hex, 'hex'));
    });

    test('rejects a missing value', () => {
      expect(() => parseKey('TEST_KEY', undefined)).toThrow('TEST_KEY must be a 64-character hex string');
    });

    test('rejects a value of the wrong length', () => {
      expect(() => parseKey('TEST_KEY', 'abcd')).toThrow('TEST_KEY must be a 64-character hex string');
    });
  });

  describe('encryptWithKey / decryptWithKey', () => {
    test('round-trips a plaintext with the same key', () => {
      const original = 'my-private-key-pem-contents';
      const encrypted = encryptWithKey(original, keyA);
      expect(decryptWithKey(encrypted, keyA)).toBe(original);
    });

    test('returns a string with 3 colon-separated parts', () => {
      const parts = encryptWithKey('hello', keyA).split(':');
      expect(parts).toHaveLength(3);
    });

    test('same plaintext encrypted twice produces different ciphertexts (random IV)', () => {
      const enc1 = encryptWithKey('same-text', keyA);
      const enc2 = encryptWithKey('same-text', keyA);
      expect(enc1).not.toBe(enc2);
    });

    test('decrypting with a different key than it was encrypted with throws', () => {
      const encrypted = encryptWithKey('secret', keyA);
      expect(() => decryptWithKey(encrypted, keyB)).toThrow();
    });

    test('decrypting tampered ciphertext throws (GCM auth tag catches it)', () => {
      const encrypted = encryptWithKey('secret', keyA);
      const parts = encrypted.split(':');
      parts[2] = 'ff' + parts[2].slice(2);
      expect(() => decryptWithKey(parts.join(':'), keyA)).toThrow();
    });

    test('rejects an invalid format', () => {
      expect(() => decryptWithKey('not-valid', keyA)).toThrow('Ciphertext format is invalid');
    });
  });

  describe('cross-compatibility with src/services/crypto.service.js', () => {
    // The whole point of this script is decrypting real issuers.encrypted_private_key
    // rows and writing back ciphertext the running app can decrypt - if this file's
    // format ever drifted from crypto.service.js's, rotation would silently corrupt
    // every issuer's signing key. These two tests are the guardrail.
    let cryptoService;
    let restoreEncryptionKey;

    beforeEach(() => {
      restoreEncryptionKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = keyA.toString('hex');
      jest.resetModules();
      cryptoService = require('../../../src/services/crypto.service');
    });

    afterEach(() => {
      process.env.ENCRYPTION_KEY = restoreEncryptionKey;
      jest.resetModules();
    });

    test('this script can decrypt what crypto.service.js encrypted', () => {
      const original = 'a real private key would go here';
      const encryptedByApp = cryptoService.encrypt(original);
      expect(decryptWithKey(encryptedByApp, keyA)).toBe(original);
    });

    test('crypto.service.js can decrypt what this script re-encrypted', () => {
      const original = 'a real private key would go here';
      const reEncryptedByScript = encryptWithKey(original, keyA);
      expect(cryptoService.decrypt(reEncryptedByScript)).toBe(original);
    });
  });
});
