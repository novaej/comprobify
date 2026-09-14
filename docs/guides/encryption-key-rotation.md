# ENCRYPTION_KEY Rotation

See `docs/deployment.md`'s "Rotating secrets" section for *why* this is dangerous and different from rotating `ADMIN_SECRET` or DB credentials — in short, `ENCRYPTION_KEY` is the only thing standing between `issuers.encrypted_private_key` and being unreadable garbage, so swapping the env var alone (without re-encrypting existing rows first) permanently breaks every existing issuer's ability to sign documents.

`scripts/rotate-encryption-key.js` does the actual re-encryption. This guide covers how to run it.

---

## What the script does

Self-contained — it reimplements the same AES-256-GCM format `src/services/crypto.service.js` uses, rather than requiring that module directly, since it needs to hold two different keys (old and new) in the same run and `crypto.service.js`'s functions read a single global `ENCRYPTION_KEY`. Kept in sync by `tests/unit/scripts/rotate-encryption-key.test.js`, which asserts cross-compatibility against the real `crypto.service.js` — if that module's format ever changes, both files need a matching update.

Runs the whole rotation as one transaction: `SELECT ... FOR UPDATE` on every `issuers` row with a key set (no `active` filter — a soft-deleted issuer can be reactivated later, so its key needs to stay decryptable too), decrypt each with the old key, re-encrypt with the new key, round-trip-verify the result, then `UPDATE`. A concurrent signing request during the transaction blocks briefly rather than seeing a half-rotated state; nothing partial can ever land — one failed row rolls back the entire batch.

`--dry-run` runs that identical transaction but `ROLLBACK`s instead of `COMMIT`s at the end — real DB read, real decrypt/re-encrypt/verify against real data, zero writes. Always run this before a real rotation.

**The script prompts for both keys interactively, with input hidden — it deliberately does not accept `OLD_ENCRYPTION_KEY`/`NEW_ENCRYPTION_KEY` as env vars or CLI arguments.** This is the incident-response tool for a suspected key compromise, so it must never be the thing that leaks the *new* key via shell history or `ps` output during the exact moment an attacker with residual access might be watching either — see "Why the interactive prompt" below for the full reasoning. This needs a real interactive terminal (the prompt uses stdin raw mode) — running it non-interactively (piped/redirected stdin, or `docker compose exec -T`) fails fast with a clear error instead of hanging.

---

Test against a copy of real data before ever rotating for real — see `docs/guides/database-backups.md` for getting an importable dump from staging or production.

## Local / dev / staging, with direct DB access

```bash
# Always dry-run first
node scripts/rotate-encryption-key.js --dry-run
# OLD_ENCRYPTION_KEY: <type it, hidden>
# NEW_ENCRYPTION_KEY: <type it, hidden>

# Then for real
node scripts/rotate-encryption-key.js
# OLD_ENCRYPTION_KEY: <type it, hidden>
# NEW_ENCRYPTION_KEY: <type it, hidden>

# Then immediately update ENCRYPTION_KEY (e.g. in .env) — don't leave a gap
```

Generate a new key the same way as a first-time one:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Needs the same `DB_*` env vars the app itself uses.

---

## On staging/production

The droplet's Postgres isn't publicly reachable (see `docs/deployment.md`'s production security checklist), so this has to run *from* the droplet, inside the already-running `api` container — same reasoning as `scripts/run-admin-job.js`'s `docker compose exec` pattern.

**Use `-it`, not `-T`** — the script's interactive prompt needs a real pseudo-terminal to read hidden input from; `-T` disables that and the script will fail fast with a clear error instead of hanging:

```bash
ssh -i ~/.ssh/comprobify_deploy_staging cpfydeploy9x@<droplet-ip>   # swap in production's key/user for that environment
cd /opt/comprobify

docker compose exec -it api node scripts/rotate-encryption-key.js --dry-run
# OLD_ENCRYPTION_KEY: <type it, hidden>
# NEW_ENCRYPTION_KEY: <type it, hidden>

# then, if that looks right:
docker compose exec -it api node scripts/rotate-encryption-key.js
# OLD_ENCRYPTION_KEY: <type it, hidden>
# NEW_ENCRYPTION_KEY: <type it, hidden>
```

Then immediately update `ENCRYPTION_KEY` in the `staging`/`production` GitHub Environment and trigger a redeploy — every issuer's signing is broken in the gap between the script committing and the app restarting with the new key, so don't let that gap sit open.

### Why the interactive prompt

This script exists specifically for incident response to a *suspected key compromise* — which means whoever's in there may already have residual access to this exact droplet (a backdoor, a lingering shell) and could be watching `ps`/reading shell history in real time while you run it. The old key being readable that way isn't new information to them (they're already assumed to have it, however they got in) — what actually matters is the *new* key, the one meant to lock them back out. Typing either key as `-e KEY=value` (a prior version of this doc) or any other CLI-argument/env-var form leaves it sitting in both the shell's history file and the process list (`ps aux`) for anyone with access to that same droplet to read — including, in this scenario, the new key you're trying to establish. Prompting for it interactively with hidden input means neither key ever appears in a command line or gets echoed anywhere — only whoever's physically watching the screen at the moment of typing sees it.

This is a different, narrower problem than `/opt/comprobify/.env` sitting on the droplet in plaintext (a separate, already-accepted trade-off — see `docs/deployment.md`'s "Rotating secrets" and `NEXT_STEPS.md`'s secrets-manager item). After a successful rotation, the new key does land in `.env` the same way the old one did, which is fine and expected — normal operation, not an incident. The point of the prompt is only to avoid an *additional*, avoidable leak of the new key during the narrow window of the rotation itself.

---

## Testing

`tests/unit/scripts/rotate-encryption-key.test.js` covers the pure crypto functions (`encryptWithKey`/`decryptWithKey`/`parseKey`) and cross-compatibility with `crypto.service.js` — runs in CI as part of `npm test`. It does **not** touch the database: `main()` (the actual DB-interaction path — the transaction, the `SELECT`/`UPDATE`) is lazily required and guarded by `require.main === module`, so importing the script's exports for testing never triggers it. That path has been verified manually (dry-run and a real forward/backward rotation, both against a real local database) but has no automated coverage — same gap `scripts/run-admin-job.js` and `scripts/verify-signature.js` already have, since neither has any tests at all.
