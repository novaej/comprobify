# ENCRYPTION_KEY Rotation

See `docs/deployment.md`'s "Rotating secrets" section for *why* this is dangerous and different from rotating `ADMIN_SECRET` or DB credentials — in short, `ENCRYPTION_KEY` is the only thing standing between `issuers.encrypted_private_key` and being unreadable garbage, so swapping the env var alone (without re-encrypting existing rows first) permanently breaks every existing issuer's ability to sign documents.

`scripts/rotate-encryption-key.js` does the actual re-encryption. This guide covers how to run it.

---

## What the script does

Self-contained — it reimplements the same AES-256-GCM format `src/services/crypto.service.js` uses, rather than requiring that module directly, since it needs to hold two different keys (old and new) in the same run and `crypto.service.js`'s functions read a single global `ENCRYPTION_KEY`. Kept in sync by `tests/unit/scripts/rotate-encryption-key.test.js`, which asserts cross-compatibility against the real `crypto.service.js` — if that module's format ever changes, both files need a matching update.

Runs the whole rotation as one transaction: `SELECT ... FOR UPDATE` on every `issuers` row with a key set (no `active` filter — a soft-deleted issuer can be reactivated later, so its key needs to stay decryptable too), decrypt each with the old key, re-encrypt with the new key, round-trip-verify the result, then `UPDATE`. A concurrent signing request during the transaction blocks briefly rather than seeing a half-rotated state; nothing partial can ever land — one failed row rolls back the entire batch.

`--dry-run` runs that identical transaction but `ROLLBACK`s instead of `COMMIT`s at the end — real DB read, real decrypt/re-encrypt/verify against real data, zero writes. Always run this before a real rotation.

---

Test against a copy of real data before ever rotating for real — see `docs/guides/database-backups.md` for getting an importable dump from staging or production.

## Local / dev / staging, with direct DB access

```bash
# Always dry-run first
OLD_ENCRYPTION_KEY=<current key> NEW_ENCRYPTION_KEY=<new key> \
  node scripts/rotate-encryption-key.js --dry-run

# Then for real
OLD_ENCRYPTION_KEY=<current key> NEW_ENCRYPTION_KEY=<new key> \
  node scripts/rotate-encryption-key.js

# Then immediately update ENCRYPTION_KEY (e.g. in .env) — don't leave a gap
```

Generate a new key the same way as a first-time one:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Needs the same `DB_*` env vars the app itself uses.

---

## On staging/production

The droplet's Postgres isn't publicly reachable (see `docs/deployment.md`'s production security checklist), so this has to run *from* the droplet, inside the already-running `api` container — same reasoning as `scripts/run-admin-job.js`'s `docker compose exec` pattern:

```bash
ssh -i ~/.ssh/comprobify_deploy_staging cpfydeploy9x@<droplet-ip>   # swap in production's key/user for that environment
cd /opt/comprobify

docker compose exec -T -e OLD_ENCRYPTION_KEY=<current> -e NEW_ENCRYPTION_KEY=<new> \
  api node scripts/rotate-encryption-key.js --dry-run

# then, if that looks right:
docker compose exec -T -e OLD_ENCRYPTION_KEY=<current> -e NEW_ENCRYPTION_KEY=<new> \
  api node scripts/rotate-encryption-key.js
```

Then immediately update `ENCRYPTION_KEY` in the `staging`/`production` GitHub Environment and trigger a redeploy — every issuer's signing is broken in the gap between the script committing and the app restarting with the new key, so don't let that gap sit open.

**Known gap:** typing the keys directly in that SSH session lands them in shell history and the droplet's process list. Acceptable for now given how rarely this runs, but worth revisiting (e.g. a stdin prompt instead of env vars) before this is ever run against a real suspected compromise rather than a test.

---

## Testing

`tests/unit/scripts/rotate-encryption-key.test.js` covers the pure crypto functions (`encryptWithKey`/`decryptWithKey`/`parseKey`) and cross-compatibility with `crypto.service.js` — runs in CI as part of `npm test`. It does **not** touch the database: `main()` (the actual DB-interaction path — the transaction, the `SELECT`/`UPDATE`) is lazily required and guarded by `require.main === module`, so importing the script's exports for testing never triggers it. That path has been verified manually (dry-run and a real forward/backward rotation, both against a real local database) but has no automated coverage — same gap `scripts/run-admin-job.js` and `scripts/verify-signature.js` already have, since neither has any tests at all.
