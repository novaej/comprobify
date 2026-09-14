# Database Backups and Restores

Two directions covered here: pulling a `pg_dump` from staging or production's DigitalOcean Managed Postgres cluster to use somewhere else (most likely your local `comprobify_local` database — e.g. to test `scripts/rotate-encryption-key.js` against realistic data, per `docs/guides/encryption-key-rotation.md`), and the reverse — restoring a backup **back into the same cluster**, the actual disaster-recovery scenario. See "Restoring to the same cluster" below for the second one; everything through step 6 covers the first.

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

**Don't dump as `comprobify_app`, the app's own role.** `db/migrations/031_row_level_security.sql` sets `FORCE ROW LEVEL SECURITY` on `documents`/`sequential_numbers`/`document_line_items`/`document_events` — deliberately, so RLS applies even to the table owner, closing the usual "owners bypass RLS" loophole (see `CLAUDE.md`'s "Row-Level Security" entry). `api_keys` was originally in this list too, but RLS was dropped from it in migration 042 (authentication happens before any issuer context can be set, so RLS never made sense there — `api_keys` is filtered by `tenant_id` at the application layer instead). `comprobify_app` owns the 4 remaining tables, so `pg_dump` connecting as it hits that same enforcement and refuses to `COPY` the data out (`ERROR: query would be affected by row-level security policy`).

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

## Restoring to the same cluster (disaster recovery)

Everything above pulls a copy **out** for local testing. This is the other direction — putting a backup **back** into the live cluster, the actual recovery scenario (data corruption, a bad migration, or validating a scheduled-backup product actually works).

### Don't trust a third-party tool's automated "Restore" button against this schema

We use [SnapShooter](https://snapshooter.com) for scheduled, automated backups (DO's own backup product, storing to a separate-region destination — see the production readiness checklist). Its backup step works fine. Its **restore** step reproducibly does not, against this specific schema: across two separate attempts (one against an already-populated target, one against a freshly-migrated empty one — ruling out a stale-lock or leftover-object explanation), its "remove all tables before restoring" cleanup step consistently left the `sandbox` schema, its 5 mirrored tables (`documents`, `document_line_items`, `document_events`, `sequential_numbers`, `sri_responses` — the exact set that exists identically in both `public` and `sandbox`, per CLAUDE.md's "Sandbox PostgreSQL schema" entry), and their functions/triggers untouched, while correctly dropping everything else. The subsequent restore then collided with those survivors (`ERROR: relation "documents" already exists`, `ERROR: multiple primary keys for table "X" are not allowed`, etc.) and still reported `Restore Success` despite dozens of errors. Root cause not confirmed (likely something in how the tool enumerates/qualifies table names against a schema that deliberately duplicates the same table names across two schemas), but the practical conclusion holds regardless: **use SnapShooter (or any similar tool) only for taking the scheduled backup. Do the actual restore manually**, below.

### The manual restore procedure (validated against real production data)

1. Stop the worker container so it can't touch the database mid-restore (`api` can stay up — health checks will just fail/error for the duration, harmless with no live traffic depending on it):
   ```bash
   cd /opt/comprobify
   docker compose stop worker
   ```

2. Get the backup file — download the `.sql.gz` from wherever it's stored (SnapShooter's dashboard, etc.). It's a plain-text `pg_dump`, not the custom `-F c` format this doc's own step 4 produces, so it restores via `psql`, not `pg_restore`.

3. As `doadmin`, wipe the target completely. This is necessary even though the dump carries its own object definitions — a plain-text dump has no `--clean` equivalent (unlike `pg_restore --clean --if-exists` in step 5 above), so it only ever `CREATE`s, never `DROP`s first:
   ```sql
   DROP SCHEMA IF EXISTS sandbox CASCADE;
   DROP SCHEMA public CASCADE;
   CREATE SCHEMA public;
   GRANT ALL ON SCHEMA public TO comprobify_app;
   ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO comprobify_app;
   ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO comprobify_app;
   ```
   Run the `GRANT`s every time, not just when something fails — a real incident: restoring into a freshly-recreated `public` schema with no grant yet applied produced a wall of `ERROR: permission denied for schema public` on roughly half the objects (the dump's own embedded ownership/privilege statements don't take effect until they're reached later in the script, so anything created before that point needs the schema-level grant already in place).

4. Load the dump with `-v ON_ERROR_STOP=1`, so a genuine problem halts the restore immediately with one clear error instead of silently continuing past it and leaving a confusing mix of successes and failures to untangle afterward:
   ```bash
   gunzip -c comprobify_production_db.sql.gz | psql -v ON_ERROR_STOP=1 "postgresql://doadmin:<doadmin password>@<DB_HOST>:<DB_PORT>/<DB_NAME>?sslmode=require"
   ```

5. Bring the app back up and verify:
   ```bash
   docker compose restart api worker
   docker compose ps                        # all 4 containers Up
   docker compose logs api --tail 50         # clean startup, no crash loop
   docker compose logs worker --tail 50
   curl -s https://api.comprobify.com/health # {"status":"ok",...}
   ```
   Then confirm the database is actually reachable through real app code, not just that the process is alive:
   ```bash
   docker compose exec -T api node -e "
   fetch('http://localhost:8080/v1/admin/tenants', { headers: { Authorization: 'Bearer ' + process.env.ADMIN_SECRET } })
     .then(r => r.json()).then(j => console.log(JSON.stringify(j)))
   "
   ```

6. Re-verify privileges landed exactly as expected — the dump carries its own `REVOKE`/`GRANT`/`ALTER DEFAULT PRIVILEGES` statements (whatever the source database's privilege state was at backup time), so confirm rather than assume nothing drifted:
   ```sql
   SELECT rolname, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'comprobify_app';
   -- all three must read false

   SELECT nspname, nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname IN ('public', 'sandbox');
   -- public -> doadmin, sandbox -> comprobify_app

   SELECT schemaname, tablename, tableowner FROM pg_tables
   WHERE schemaname IN ('public', 'sandbox') AND tableowner <> 'comprobify_app';
   -- must return zero rows — every table should be comprobify_app-owned, none doadmin-owned

   SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
   WHERE relname IN ('documents','document_line_items','document_events','sequential_numbers')
     AND relnamespace = 'public'::regnamespace;
   -- both columns true for all 4 rows
   ```

### Testing the restore, versus actually recovering from something

Test this procedure against production only when there's genuinely nothing to lose (e.g. pre-launch, no real tenant data yet) — it drops and rebuilds the schema from scratch. Once real tenant data is flowing, validate a restore against a scratch logical database on the same cluster instead (`CREATE DATABASE comprobify_restore_test;` as `doadmin`, same host/port/credentials, different `DATABASE` in the connection string), never against the live database.

---

## DigitalOcean's own automated backups (a separate, native layer)

Independent of SnapShooter: DO Managed Postgres clusters get continuous automated backups (base backup + WAL archiving — point-in-time recovery, not fixed daily snapshot files) built into the product itself, no setup required. There's no snapshot-browsing UI for this the way there is for droplets — the only entry point is the cluster's **Actions → Restore from backup**, which picks a point in time within the retention window (observed retention: back to ~5 days) and **always creates a brand-new cluster** from it, never an in-place restore. The new cluster comes back with everything the physical backup captured — roles, grants, RLS/FORCE RLS settings, extensions — reconstructed exactly as they were at that point, unlike the manual SnapShooter-dump restore above, which has to carefully recreate grants on an already-existing target schema.

**Same region as the live cluster** (no region picker appeared during a real test of this flow) — this is what makes it a *complementary* layer to SnapShooter, not a replacement: it recovers from data corruption, a bad migration, or an accidental `DROP`/`DELETE` far faster and more completely than the manual dump/restore path, but it does **not** protect against a regional DigitalOcean outage the way SnapShooter's separate-region storage does. Keep both.

**Using it for a real disaster (not yet tested end-to-end — treat this as the plan, verify each step live if it's ever actually needed):**

1. Trigger **Restore from backup** on the cluster, picking the point in time just before whatever went wrong. This provisions a new cluster (new host, likely same port/`DB_NAME`) — expect it to take some minutes to come up, same as provisioning any new Managed Database.
2. Add the droplet's IP (or re-add it, if it's not already covered) to the **new** cluster's Trusted Sources — a restored cluster's Trusted Sources list is not confirmed to carry over from the original; verify this rather than assume it, the first time this is actually exercised.
3. Update `DB_HOST` (and `DB_PORT`/`DB_SSL_CA` if either changed) in the `staging`/`production` GitHub Environment's Secrets/Variables, then trigger a deploy so the droplet's `.env` picks up the new connection details — same mechanism `docs/deployment.md`'s "Rotating secrets" section already documents for any other credential rotation.
4. Verify the same way step 5 of the manual restore above does: `docker compose ps`/`logs`, `GET /health`, and a real authenticated admin-API call — not just that the containers are up.
5. Decide what happens to the old cluster once the new one is confirmed healthy — keep it briefly for forensics on what went wrong, then destroy it (a second live cluster is a second cluster's worth of billing).

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
