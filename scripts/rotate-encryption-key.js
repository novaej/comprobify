#!/usr/bin/env node
/**
 * Rotates ENCRYPTION_KEY - decrypts every issuers.encrypted_private_key with
 * the OLD key, re-encrypts with the NEW key, writes it back. Must run (and
 * succeed) BEFORE cutting the ENCRYPTION_KEY env var over and restarting -
 * see CLAUDE.md's "Rotating secrets" section for why: changing the env var
 * first, without this step, permanently breaks every existing issuer's
 * ability to sign documents (a full outage, not a gradual one).
 *
 * Self-contained: reimplements AES-256-GCM encrypt/decrypt matching
 * src/services/crypto.service.js's exact format (<iv_hex>:<authTag_hex>:
 * <ciphertext_hex>) rather than requiring that module, since this script
 * needs two different keys (old and new) in the same run and
 * crypto.service.js's functions read a single global ENCRYPTION_KEY. Kept in
 * sync by tests/unit/scripts/rotate-encryption-key.test.js, which asserts
 * cross-compatibility against the real crypto.service.js. If that module's
 * format ever changes, this file and its test need a matching update.
 *
 * Usage:
 *   OLD_ENCRYPTION_KEY=... NEW_ENCRYPTION_KEY=... node scripts/rotate-encryption-key.js [--dry-run]
 *
 * --dry-run: runs the exact same transaction (decrypt with OLD_ENCRYPTION_KEY,
 * re-encrypt with NEW_ENCRYPTION_KEY, round-trip verify) but rolls back
 * instead of committing - nothing is written. Always run this first, and
 * against a copy of production data before ever rotating for real - see
 * CLAUDE.md: "that script needs to be written and tested ... before rotating
 * for real. Don't attempt this live for the first time during an actual
 * incident."
 *
 * Requires the same DB_* env vars as the app itself (connects via
 * src/config/database.js).
 *
 * The whole rotation runs as one transaction with SELECT ... FOR UPDATE, so
 * a concurrent signing request either sees the fully-old or fully-new state,
 * never a mix - but the moment this commits, the DB holds ciphertext the old
 * key can no longer decrypt. Update ENCRYPTION_KEY and redeploy immediately
 * after a successful (non-dry-run) run; don't leave a gap.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function parseKey(name, hex) {
  if (!hex || hex.length !== 64) {
    throw new Error(`${name} must be a 64-character hex string (32 bytes)`);
  }
  return Buffer.from(hex, 'hex');
}

// Mirrors src/services/crypto.service.js's encrypt(), parameterised by an
// explicit key instead of reading the single global ENCRYPTION_KEY.
function encryptWithKey(plaintext, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

// Mirrors src/services/crypto.service.js's decrypt(), parameterised by an
// explicit key instead of reading the single global ENCRYPTION_KEY.
function decryptWithKey(ciphertext, key) {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Ciphertext format is invalid (expected iv:authTag:data)');
  }
  const [ivHex, authTagHex, encrypted] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8'); // throws if the auth tag doesn't match
  return decrypted;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const oldKeyHex = process.env.OLD_ENCRYPTION_KEY;
  const newKeyHex = process.env.NEW_ENCRYPTION_KEY;

  if (oldKeyHex && newKeyHex && oldKeyHex === newKeyHex) {
    throw new Error('OLD_ENCRYPTION_KEY and NEW_ENCRYPTION_KEY must differ');
  }
  const oldKey = parseKey('OLD_ENCRYPTION_KEY', oldKeyHex);
  const newKey = parseKey('NEW_ENCRYPTION_KEY', newKeyHex);

  const db = require('../src/config/database');
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // No active-only filter: an inactive (soft-deleted) issuer can still be
    // reactivated later (PATCH /v1/issuers/:id/activate), so its key needs
    // to stay decryptable too.
    const { rows } = await client.query(
      'SELECT id, encrypted_private_key FROM issuers WHERE encrypted_private_key IS NOT NULL FOR UPDATE'
    );

    console.log(`Found ${rows.length} issuer(s) with an encrypted private key.`);

    for (const row of rows) {
      const plaintext = decryptWithKey(row.encrypted_private_key, oldKey);
      const reEncrypted = encryptWithKey(plaintext, newKey);

      // Round-trip check before trusting the new ciphertext - catches a
      // mistake in this script before it ever reaches the database.
      if (decryptWithKey(reEncrypted, newKey) !== plaintext) {
        throw new Error(`Round-trip verification failed for issuer ${row.id}`);
      }

      if (!dryRun) {
        await client.query('UPDATE issuers SET encrypted_private_key = $1 WHERE id = $2', [reEncrypted, row.id]);
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log(`[dry run] ${rows.length} issuer(s) verified - decrypts with OLD_ENCRYPTION_KEY, re-encrypts and round-trips cleanly with NEW_ENCRYPTION_KEY. No changes written.`);
    } else {
      await client.query('COMMIT');
      console.log(`Rotated ${rows.length} issuer(s) to the new key. Update ENCRYPTION_KEY in every environment and redeploy now - the database already holds ciphertext the old key can no longer decrypt.`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Rotation failed, rolled back - no data was changed.');
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { encryptWithKey, decryptWithKey, parseKey };
