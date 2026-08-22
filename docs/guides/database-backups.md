# Database Backups — Getting an Importable Dump from Staging/Production

How to pull a `pg_dump` from staging or production's DigitalOcean Managed Postgres cluster and import it somewhere else (most likely your local `comprobify_local` database) — e.g. to test `scripts/rotate-encryption-key.js` against realistic data, per `docs/guides/encryption-key-rotation.md`'s recommendation to test against a copy of production data before ever rotating for real.

---

## Before you start: know what you're actually copying

**A staging dump is low-stakes** — staging always talks to SRI's test endpoint (`ambiente = 1`, see `docs/terraform-digitalocean-setup.md`'s "Sandbox environment + SRI routing" table), so every document, buyer, and tenant in it is inherently test data.

**A production dump is not.** It contains real tenant PII (names, emails, RUCs), real buyer data, and `issuers.encrypted_private_key` for real signing certificates (encrypted at rest with `ENCRYPTION_KEY`, but still sensitive — see `docs/deployment.md`'s "Rotating secrets"). Treat a production dump like the real customer data it is: don't commit it anywhere, don't leave it sitting on a laptop indefinitely, and delete the local copy once you're done with it. This isn't boilerplate — the Privacy Policy's own data-handling commitments (`docs/agreements/privacy-policy.md`) apply to wherever tenant data actually ends up, not just the production database itself.

The cluster is shared with `comprobify-web`, but on a **separate logical database**, not just a separate schema (confirmed in that repo's own `docs/deployment.md`: "Use a separate logical database from the Comprobify API DB"). Dumping comprobify's own `DB_NAME` (`defaultdb` unless the cluster was provisioned with a different name) naturally excludes comprobify-web's data — nothing extra to filter out.

---

## 1. Add your IP to Trusted Sources

The cluster restricts connections via DigitalOcean's **Trusted Sources** — your laptop isn't on that list by default. DO dashboard → the cluster → **Settings** → **Trusted Sources** → add your current IP (`curl -s ifconfig.me` to get it).

This is a real, if temporary, widening of who can reach the database directly — **remove it again once you're done** (step 6 below). Don't leave it in place indefinitely.

## 2. Get the connection details — use `doadmin`, not `comprobify_app`

**Don't dump as `comprobify_app`, the app's own role.** `db/migrations/031_row_level_security.sql` sets `FORCE ROW LEVEL SECURITY` on `documents`/`sequential_numbers`/`api_keys`/`document_line_items`/`document_events` — deliberately, so RLS applies even to the table owner, closing the usual "owners bypass RLS" loophole (see `CLAUDE.md`'s "Row-Level Security" entry). `comprobify_app` owns those tables, so `pg_dump` connecting as it hits that same enforcement and refuses to `COPY` the data out (`ERROR: query would be affected by row-level security policy`).

`pg_dump`'s own error HINT suggests `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY` — **do not do this.** `comprobify_app` is the exact role the live running app uses for every real request. Disabling FORCE RLS on the owner doesn't just unblock your dump, it silently disables tenant isolation for real production/staging traffic until someone remembers to turn it back on — not an acceptable trade-off for a one-off backup, even briefly, on a live system.

Instead, get the cluster's **admin (`doadmin`)** connection details — DigitalOcean dashboard → the cluster → **Connection Details** → switch the "User" dropdown from `comprobify_app`/`comprobify_web_app` (or whatever the app role is called) to `doadmin`. This role is never used by the live app (`CLAUDE.md`'s "app user must not be a superuser" rule is specifically about what the *app* connects as) — using it for a one-off offline dump doesn't touch the running app's security posture at all, and it bypasses RLS entirely with no schema change needed. `DB_HOST`/`DB_PORT`/`DB_NAME` stay the same as the app's own values (same GitHub Secrets); only the user/password differ.

Check the cluster's actual Postgres major version on that same Connection Details page (or `SELECT version();` once connected) — match it below rather than guessing, since `pg_dump` isn't always safe to run against a much newer or older server major version than itself.

## 3. Install Postgres client tools locally, if you don't have them

```bash
brew install libpq
brew link --force libpq   # puts pg_dump/pg_restore/psql on PATH
```

## 4. Dump directly to your laptop

```bash
pg_dump "postgresql://doadmin:<doadmin password>@<DB_HOST>:<DB_PORT>/<DB_NAME>?sslmode=require" \
  --no-owner --no-privileges -F c -f ./backup.dump
```

`-F c` (custom format) — compressed, and supports `pg_restore`'s `--clean`/selective-restore/parallel-restore options on the way back in. `--no-owner --no-privileges` strips role-specific `GRANT`/`OWNER TO` statements, since neither your local roles nor `doadmin` match `comprobify_app` (the role that actually owns these tables and that you'll restore as locally) — without this, restoring would fail or silently skip ownership it can't apply. `sslmode=require` matches `DB_SSL=true`'s intent; the cluster's private CA doesn't need to be presented client-side for a plain `require` (no `verify-full`) connection.

## 5. Import it into your local database

Restores into `comprobify_local` (per `.env`), replacing what's there:

```bash
pg_restore --no-owner --no-privileges --clean --if-exists \
  -h localhost -p 5432 -U comprobify_app -d comprobify_local \
  ./backup.dump
```

`--clean --if-exists` drops existing objects before recreating them, so this is safe to run against a database that already has the schema applied (from `npm run migrate`) — it won't error on "already exists."

## 6. Clean up

```bash
rm ./backup.dump
```

And remove your IP from the cluster's Trusted Sources again (DO dashboard → the cluster → Settings) — don't leave direct access open past this session, especially for production.

---

## Alternative: dump from the droplet instead

If you'd rather not touch Trusted Sources at all (e.g. a dynamic IP that changes often, making step 1/6 annoying to repeat), the droplet's reserved IP is already trusted — SSH in and run `pg_dump` there instead, via a throwaway container since the droplet has Docker but no Postgres client tools installed. Same `doadmin`-not-`comprobify_app` reasoning as step 2 applies here too:

```bash
ssh -i ~/.ssh/comprobify_deploy_staging cpfydeploy9x@<droplet-ip>   # swap in production's key/user for that environment
docker run --rm postgres:<matching-major>-alpine \
  pg_dump "postgresql://doadmin:<doadmin password>@<DB_HOST>:<DB_PORT>/<DB_NAME>?sslmode=require" \
  --no-owner --no-privileges -F c > /opt/comprobify/backup.dump
```

Then `scp` it down and delete the remote copy:

```bash
# from your local machine, not the SSH session
scp -i ~/.ssh/comprobify_deploy_staging cpfydeploy9x@<droplet-ip>:/opt/comprobify/backup.dump ./backup.dump

# back on the droplet
rm /opt/comprobify/backup.dump
```

Then continue from step 5 above (import), then step 6 (clean up — just the local file this time, no Trusted Sources change needed either way, since the droplet was already on the list).
