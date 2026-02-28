/**
 * AES-256-GCM symmetric encryption for storing sensitive values (certificate
 * passwords) in the database. The encryption key never leaves the server
 * environment — it lives only in the ENCRYPTION_KEY env var.
 *
 * Stored format: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * Why AES-256-GCM:
 *  - 256-bit key = strongest standard AES key size
 *  - GCM mode provides authenticated encryption: if the ciphertext or key is
 *    tampered with, decryption throws instead of silently returning garbage
 *  - Each encrypt() call generates a fresh random IV (initialisation vector),
 *    so encrypting the same plaintext twice produces different ciphertexts
 */

const crypto = require('crypto');
const config = require('../config');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;       // 128-bit IV — standard for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag — GCM default

/**
 * Parses and validates the ENCRYPTION_KEY env var into a 32-byte Buffer.
 * Called on every encrypt/decrypt so a misconfigured key fails immediately
 * rather than at startup when the variable might not yet be set.
 */
function getKey() {
  const hex = config.encryptionKey;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 *
 * Steps:
 *  1. Generate a cryptographically random 16-byte IV for this encryption only
 *  2. Create a GCM cipher with the 32-byte key + IV
 *  3. Stream the plaintext through the cipher to produce hex ciphertext
 *  4. Finalise the cipher and extract the 16-byte GCM authentication tag
 *  5. Return the three components joined by ':' so they can be stored as a
 *     single string and later split apart by decrypt()
 *
 * @param {string} plaintext
 * @returns {string} "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
function encrypt(plaintext) {
  const key = getKey();

  // A new random IV for every encryption — ensures identical plaintexts
  // produce different ciphertexts (semantic security)
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // GCM produces an authentication tag after finalisation; it must be saved
  // alongside the ciphertext to verify integrity during decryption
  const authTag = cipher.getAuthTag();

  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

/**
 * Decrypts a string produced by encrypt().
 *
 * Steps:
 *  1. Split the stored value back into IV, auth tag, and ciphertext
 *  2. Create a GCM decipher with the same key + original IV
 *  3. Set the auth tag — GCM will verify it during final(); if the ciphertext
 *     or key has been tampered with, final() throws "Unsupported state or
 *     unable to authenticate data"
 *  4. Stream the hex ciphertext back to UTF-8 plaintext
 *
 * @param {string} ciphertext "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * @returns {string} original plaintext
 */
function decrypt(ciphertext) {
  const key = getKey();

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const iv      = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  // Auth tag must be set before calling update/final so GCM can verify
  // the integrity of the ciphertext at the end of decryption
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8'); // throws if auth tag does not match
  return decrypted;
}

module.exports = { encrypt, decrypt };
