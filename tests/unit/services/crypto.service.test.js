const crypto = require('crypto');

// Generate a test key before requiring the module
const testKey = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY = testKey;

const cryptoService = require('../../../src/services/crypto.service');

describe('CryptoService', () => {
  test('encrypt returns a string with 3 colon-separated parts', () => {
    const result = cryptoService.encrypt('hello');
    const parts = result.split(':');
    expect(parts).toHaveLength(3);
  });

  test('encrypt → decrypt roundtrip produces original plaintext', () => {
    const original = 'my-secret-password-123!@#';
    const encrypted = cryptoService.encrypt(original);
    const decrypted = cryptoService.decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  test('different plaintexts produce different ciphertexts', () => {
    const enc1 = cryptoService.encrypt('password1');
    const enc2 = cryptoService.encrypt('password2');
    expect(enc1).not.toBe(enc2);
  });

  test('same plaintext encrypted twice produces different ciphertexts (random IV)', () => {
    const enc1 = cryptoService.encrypt('same-text');
    const enc2 = cryptoService.encrypt('same-text');
    expect(enc1).not.toBe(enc2);
  });

  test('decrypt with tampered ciphertext throws', () => {
    const encrypted = cryptoService.encrypt('test');
    const parts = encrypted.split(':');
    // Tamper with the encrypted data
    parts[2] = 'ff' + parts[2].slice(2);
    expect(() => cryptoService.decrypt(parts.join(':'))).toThrow();
  });

  test('decrypt with invalid format throws', () => {
    expect(() => cryptoService.decrypt('not-valid')).toThrow('Invalid encrypted data format');
  });

  test('handles empty string', () => {
    const encrypted = cryptoService.encrypt('');
    const decrypted = cryptoService.decrypt(encrypted);
    expect(decrypted).toBe('');
  });

  test('handles unicode text', () => {
    const original = 'contraseña con ñ y tildes: áéíóú';
    const encrypted = cryptoService.encrypt(original);
    const decrypted = cryptoService.decrypt(encrypted);
    expect(decrypted).toBe(original);
  });
});
