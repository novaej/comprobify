# Deployment

---

## Branching strategy

Two long-lived branches map to deployed environments. They are **automation-owned** — promoted forward by tags and GitHub Releases, never by direct or manual merges. Feature/fix branches are always cut from `main` and merged back via pull request.

```
  feature/xyz              main                                   staging                  production
      │                     │                                       │                          │
      │  PR + merge         │                                       │                          │
      │────────────────────▶│                                       │                          │
      │                     │  git tag vX.Y.Z + push                │                          │
      │                     │── release-staging.yml (ff-merge) ────▶│── deploy-staging.yml ───▶ comprobify-staging
      │                     │                                       │                          │
      │                     │  publish GitHub Release from the tag  │                          │
      │                     │── release-production.yml (ff-merge) ──┼─────────────────────────▶│── deploy-production.yml ──▶ comprobify-production
      │                     │                                                                   │
  hotfix/xyz                │                                                                   │
      │  branch off `production`, PR into the hotfix branch,                                   │
      │  tag vX.Y.Z+1 → same pipeline (or emergency workflow_dispatch to skip staging)         │
      │  → cherry-pick the merged fix back into `main`                                         │
      │─────────────────────────────────────────────────────────────────────────────────────▶ │
```

| Branch | Environment | Promoted by |
|--------|-------------|-------------|
| `main` | — (trunk; CI only, no deploy) | PR merge |
| `staging` | Staging (Render) | `release-staging.yml` — fast-forwarded on tag push `vX.Y.Z` |
| `production` | Production (Render) — *not yet provisioned, pipeline disabled* | `release-production.yml` — fast-forwarded when a GitHub Release is published |

**Rules:**
- All development happens in feature/fix branches off `main`, merged via PR (1 approval required)
- `staging` and `production` are **automation-owned** — never push to them directly; they only move forward via fast-forward merges performed by the release workflows. Branch protection should restrict pushes to the automation
- A **tag** (`vX.Y.Z`, semantic versioning) means *"build this, validate it in staging."* Pushing it triggers `release-staging.yml`, which fast-forwards `staging` and (via the existing push trigger) kicks off `deploy-staging.yml`
- A **published GitHub Release**, created from a tag already validated in staging, means *"staging confirmed it, ship to production."* Publishing it is the deliberate, auditable approval gate between staging and production — no extra tooling needed
- **Hotfixes** branch from the current `production` ref (not `main`, which may carry unreleased work), flow through a PR + tag through the same pipeline (or an emergency `workflow_dispatch` that skips straight to production), and **must be cherry-picked back into `main`** afterwards so the fix survives the next regular release

---

## Git workflow & commands

### Daily development

```bash
# Start a new feature
git checkout main
git pull origin main
git checkout -b feature/my-feature

# Work, commit, push
git add <files>
git commit -m "feat: describe the change"
git push origin feature/my-feature

# Open a PR to main in GitHub, review, merge

# Clean up
git checkout main && git pull origin main
git branch -d feature/my-feature
```

### Release to staging

Tag the commit on `main` you want to promote — this is the only manual step; the workflow handles the rest.

```bash
git checkout main
git pull origin main
git tag v1.4.0
git push origin v1.4.0
```

`release-staging.yml` fast-forwards `staging` to `v1.4.0` and pushes it, which triggers `deploy-staging.yml` automatically. Use semantic versioning (`vMAJOR.MINOR.PATCH`) so it's obvious at a glance whether a tag is a feature release (`v1.5.0`) or a hotfix (`v1.4.1`).

### Promote to production

Once the tag has been validated in staging, promotion is a single deliberate action — **publishing a GitHub Release from that tag**:

1. GitHub UI → **Releases → Draft a new release**
2. Choose the existing tag (e.g. `v1.4.0`) — do not create a new one
3. (Optional) generate release notes from the commits since the previous tag — this doubles as the changelog entry, since the publish event *is* the production-ship event
4. Click **Publish release**

`release-production.yml` then fast-forwards `production` to that commit and triggers `deploy-production.yml`.

> **Currently disabled** — the production Render service, `production` branch, and secrets don't exist yet. See "Production status" below for what's needed to enable this.

### Hotfix flow

Branch from the **currently-deployed `production` ref** (not `main`, which may contain unreleased work):

```bash
# 1. Cut a short-lived integration branch from what's live in prod
git checkout -b hotfix/payment-bug production

# 2. Make the fix on a sub-branch and PR it into the hotfix branch (same review rigor as any change)
git checkout -b fix/payment-rounding hotfix/payment-bug
# ...fix, commit, push, open PR: fix/payment-rounding → hotfix/payment-bug, review + merge...

# 3. Tag the merged result — this feeds the same release pipeline
git checkout hotfix/payment-bug
git pull origin hotfix/payment-bug
git tag v1.4.1
git push origin v1.4.1
```

From here, either run it through the normal tag → staging → release → production pipeline (safer, still validated), or — for true emergencies — trigger `release-production.yml` manually via `workflow_dispatch` to skip straight to production (documented as the "break-glass" path; bypasses staging validation).

**Don't skip this step:** cherry-pick the merged fix commit back into `main` so it isn't silently lost or reverted on the next regular release.

```bash
git checkout main
git pull origin main
git cherry-pick <hotfix-commit-sha>
git push origin main
```

---

## CI/CD pipeline

### Workflow files

| File | Trigger | Effect |
|------|---------|--------|
| `.github/workflows/release-staging.yml` | Push of tag `vX.Y.Z` | Fast-forwards `staging` to the tagged commit and pushes it |
| `.github/workflows/deploy-staging.yml` | Push to `staging` | Calls the Render deploy hook for `comprobify-staging` |
| `.github/workflows/release-production.yml` | *(disabled)* GitHub Release published | Fast-forwards `production` to the released commit and pushes it |
| `.github/workflows/deploy-production.yml` | *(disabled)* Push to `production` | Calls the Render deploy hook for `comprobify-production` |

### Pipeline stages (staging)

1. **Tag pushed** (`vX.Y.Z`) — `release-staging.yml` checks out the tag and fast-forward-merges `staging` to it, then pushes
2. **Push to `staging`** — `deploy-staging.yml` calls the `RENDER_DEPLOY_HOOK_URL` for `comprobify-staging`

Render handles the rest: builds the Docker image (which installs `libxml2-utils` and runs `npm ci --omit=dev`), then starts the container. Migrations run automatically at startup — `app.js` calls `migrate()` before the server begins accepting requests.

### Production status

The production pipeline is **written but disabled** — `release-production.yml` and `deploy-production.yml` exist in the repo with their triggers commented out and an `if: false` guard on their jobs, because the production Render service, `production` branch, database, domain, and secrets don't exist yet.

To enable production once it's provisioned:
1. Create the `production` branch (fast-forwarded only by the automation, same invariant as `staging`)
2. Provision the `comprobify-production` Render web service + a paid Postgres instance (for backups/PITR), with **independent** `ADMIN_SECRET` / `ENCRYPTION_KEY` / DB credentials from staging — never share these between environments
3. Add `RENDER_DEPLOY_HOOK_URL` as a secret on the `production` GitHub environment (and `STAGING_API_BASE_URL` / `ADMIN_SECRET` if mirroring the notification scheduler too)
4. In `release-production.yml`: uncomment the `release: types: [published]` trigger and remove the `if: false` guard on the `promote` job
5. In `deploy-production.yml`: uncomment the `push: branches: [production]` trigger and remove the `if: false` guard on the `deploy` job
6. Add branch protection to `production` (restrict who can push to the automation only; no force pushes) — see GitHub repository setup below
7. Set up a cron-job.org job (or equivalent external cron service) to `POST /v1/admin/jobs/notifications` on the production URL every 5 minutes with `Authorization: Bearer <ADMIN_SECRET>`

---

## Mailgun webhook setup

The API exposes an inbound webhook endpoint that Mailgun calls to report email delivery events. It updates `email_status` on documents and verification emails so the API has an accurate delivery audit trail.

```
POST /v1/mailgun/webhook
```

This is **not called by your application** — it is registered once with Mailgun so that Mailgun calls it automatically when a delivery event occurs.

### Mailgun dashboard setup

In the Mailgun dashboard, go to **Sending → Webhooks** for your domain and register:

```
https://<your-api-host>/v1/mailgun/webhook
```

Enable exactly these three event types:

| Event | Purpose |
|---|---|
| `delivered` | Marks `email_status` as `DELIVERED` |
| `failed` | Permanent failure → `FAILED`; temporary failure → logged, Mailgun retries automatically |
| `complained` | Spam report → `COMPLAINED` |

Other event types (opened, clicked, unsubscribed, etc.) are ignored — no harm in enabling them, but they produce no effect.

> **One webhook per environment.** Staging and production use separate Mailgun domains. Register the webhook on each domain pointing to the corresponding environment's URL.

### Security

Every incoming request is verified with HMAC-SHA256 using `MAILGUN_WEBHOOK_SIGNING_KEY` (found in Mailgun → Webhooks → Signing key). Requests that fail signature verification are rejected with `401`. Replayed requests (duplicate timestamps) are also rejected automatically.

### Event handling

| Mailgun event | Severity | Outcome |
|---|---|---|
| `delivered` | — | `email_status` → `DELIVERED`, event `EMAIL_DELIVERED` appended |
| `failed` | `permanent` | `email_status` → `FAILED`, event `EMAIL_FAILED` appended |
| `failed` | `temporary` | status unchanged (Mailgun retries), event `EMAIL_TEMP_FAILED` appended |
| `complained` | — | `email_status` → `COMPLAINED`, event `EMAIL_COMPLAINED` appended |

Both invoice emails and tenant verification emails are tracked through this endpoint. Lookup is by `email_message_id`, stored on each document and tenant row when the email is sent.

The endpoint always returns `200 OK` with `{ "ok": true }` for recognised events. Mailgun treats any non-2xx response as a failure and retries.

---

## Scheduled jobs

The API has one scheduled job that must be triggered by an **external cron service** — it is not self-scheduled. [cron-job.org](https://cron-job.org) is used for both environments.

### `POST /v1/admin/jobs/notifications`

Runs two tasks on every call:

1. **Certificate expiry checks** — inspects `cert_expiry` for every active issuer across all non-suspended tenants and upserts `CERT_EXPIRING` / `CERT_EXPIRED` alerts. Auto-dismisses alerts when a certificate is renewed (> 30 days remaining).
2. **Webhook retry queue** — retries all webhook deliveries in `RETRYING` status whose `next_retry_at` has passed.

The job is **idempotent** — running it multiple times within the same minute is safe.

### cron-job.org setup

| Setting | Value |
|---|---|
| **Method** | `POST` |
| **Staging URL** | `https://api-staging.comprobify.com/v1/admin/jobs/notifications` |
| **Production URL** | `https://api.comprobify.com/v1/admin/jobs/notifications` *(once provisioned)* |
| **Schedule** | Every 5 minutes |
| **Header** | `Authorization: Bearer <ADMIN_SECRET>` |
| **Expected response** | `200 OK` with JSON body |

> The `ADMIN_SECRET` for each environment is independent — never use the staging secret against the production endpoint.

### Response shape

```json
{
  "ok": true,
  "tenantsChecked": 12,
  "retries": {
    "attempted": 3,
    "succeeded": 2,
    "failed": 1,
    "exhausted": 0
  }
}
```

Monitor the cron-job.org execution log for non-200 responses. A sustained failure usually means the `ADMIN_SECRET` has rotated or the service is down.

---

## GitHub repository setup

### 1. Branches

Only `staging` exists today (already created). `production` is created when the production environment is provisioned (see "Production status" above):

```bash
git checkout main
git pull origin main
git checkout -b production
git push -u origin production
git checkout main
```

### 2. Protect `main` (Settings → Branches → Add rule)

- **Branch name pattern:** `main`
- ✅ Require a pull request before merging
- ✅ Require approvals: 1
- ✅ Dismiss stale pull request approvals when new commits are pushed
- ✅ Do not allow bypassing the above settings

### 3. Protect `staging` and `production` (Settings → Branches → Add rule, one for each)

Both branches are **automation-owned** — they only move forward via fast-forward pushes from `release-staging.yml` / `release-production.yml`. Restrict direct human pushes so the fast-forward invariant can't be broken by a stray commit:

- **Branch name pattern:** `staging` (repeat for `production`)
- ✅ Restrict who can push — limit to the automation (e.g. a bot account / `GITHUB_TOKEN` with appropriate permissions, or repository admins only as a fallback)
- ✅ Do not allow force pushes

### 4. Add secrets (Settings → Secrets and variables → Actions)

Per-environment secrets, scoped to the matching GitHub Environment (`staging` now, `production` once provisioned):

| Secret | Environment | Used by |
|---|---|---|
| `RENDER_DEPLOY_HOOK_URL` | `staging` | `deploy-staging.yml` |
| `RENDER_DEPLOY_HOOK_URL` | `production` *(when provisioned)* | `deploy-production.yml` |

Note `release-staging.yml` / `release-production.yml` don't need extra secrets — they push to branches using the workflow's own `contents: write` permission.

### 5. Render

- `comprobify-staging` web service already exists, linked to the `staging` branch via deploy hook
- When ready: create `comprobify-production` (its own web service + paid Postgres instance for backups/PITR), with independent env vars and secrets from staging — see "Production status" above
- Migrations run automatically at startup via `app.js` — no separate deploy step needed

---

## First deploy checklist

Run through this after every new environment is provisioned (staging done, repeat for production). Steps are in order.

### 1. Database user
- [ ] Create a dedicated non-superuser role in Neon's SQL Editor (never use `neondb_owner` as the app user — it bypasses RLS):
```sql
CREATE ROLE comprobify_app LOGIN PASSWORD 'strong-password';
GRANT ALL PRIVILEGES ON DATABASE neondb TO comprobify_app;
GRANT ALL ON SCHEMA public TO comprobify_app;
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO comprobify_app;
ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO comprobify_app;
```

### 2. Render service
- [ ] Set all required env vars before first deploy (see Environment variables table below) — `APP_ENV`, `APP_BASE_URL`, `DB_*`, `ENCRYPTION_KEY`, `ADMIN_SECRET`, `EMAIL_PROVIDER=none`
- [ ] `APP_BASE_URL` matches the actual Render URL (update after Render assigns one)
- [ ] Runtime: Docker (Render auto-detects the `Dockerfile` in the repo root)
- [ ] Confirm first deploy succeeds and all migrations are listed as applied in the startup log

### 3. Sandbox schema grants
After migrations run, migration 033 creates the `sandbox` schema. Grant access in Neon's SQL Editor:
- [ ] Run:
```sql
GRANT ALL ON SCHEMA sandbox TO comprobify_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA sandbox GRANT ALL ON TABLES TO comprobify_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA sandbox GRANT ALL ON SEQUENCES TO comprobify_app;
```
- [ ] Verify both schemas exist and are accessible:
```sql
SELECT schema_name, schema_owner
FROM information_schema.schemata
WHERE schema_name IN ('public', 'sandbox');
```

### 4. Custom domain (optional but recommended before production)
- [ ] Add custom domain in Render → service → Settings → Custom Domains (e.g. `api-staging.comprobify.com`)
- [ ] Add CNAME record in Cloudflare DNS: type `CNAME`, name `staging-api`, target = Render hostname, **proxy off (gray cloud)** initially
- [ ] Wait for Render to verify the domain and issue the TLS cert, then optionally enable Cloudflare proxy (orange cloud) — set Cloudflare SSL/TLS mode to **Full (strict)**
- [ ] Update `APP_BASE_URL` in Render env vars to the custom domain URL
- [ ] Update `STAGING_API_BASE_URL` GitHub environment secret to match

### 6. GitHub secrets
- [ ] `RENDER_DEPLOY_HOOK_URL` → Render service → Settings → Deploy Hook → copy URL → GitHub environment secret
- [ ] `RELEASE_PUSH_TOKEN` → GitHub repository secret (fine-grained PAT with `Contents: Read and write` on this repo)

### 7. Verify
- [ ] Health check responds `{"status":"ok"}`:
```bash
curl https://api.comprobify.com/health
```
- [ ] Admin auth works (returns `{"ok":true,"tenants":[]}`):
```bash
curl https://api.comprobify.com/v1/admin/tenants \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```
- [ ] `xmllint` available — attempt a document creation and check Render logs for XSD validation errors. On paid Render tiers, check via Shell: `which xmllint`. If missing, a Dockerfile is needed (see NEXT_STEPS.md item 5).

### 8. Pipeline smoke test
- [ ] Push a tag (`git tag vX.Y.Z && git push origin vX.Y.Z`) and confirm `Release to Staging` workflow runs and fast-forwards the `staging` branch, then `Deploy Staging` fires automatically

---

## System requirements

| Dependency | Notes |
|------------|-------|
| Node.js 18+ | LTS recommended |
| PostgreSQL 14+ | |
| `xmllint` | `apt install libxml2-utils` (Ubuntu/Debian) · pre-installed on Amazon Linux, macOS |

---

## Environment variables

All variables are required unless marked optional.

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | HTTP port (default `8080`) |
| `APP_ENV` | Yes | `staging` or `production`. Controls SRI endpoint routing — staging always uses the SRI test endpoint; production uses the production endpoint for issuers with `sandbox=false`. Default: `staging`. |
| `APP_BASE_URL` | Yes | Public base URL of this API (e.g. `https://api.yourdomain.com`). Used as the base for verification email links when no per-tenant `verificationRedirectUrl` is set. |
| `VERIFICATION_TOKEN_TTL_HOURS` | No | Email verification token lifetime in hours (default `24`). |
| `DB_HOST` | Yes | PostgreSQL host |
| `DB_PORT` | No | PostgreSQL port (default `5432`) |
| `DB_NAME` | Yes | Database name |
| `DB_USER` | Yes | Database user |
| `DB_PASSWORD` | Yes | Database password |
| `DB_SSL` | Yes | `true` to enable SSL (required in production) |
| `ENCRYPTION_KEY` | Yes | 64-character hex string — AES-256-GCM key for private key encryption |
| `ADMIN_SECRET` | Yes | 64-character hex string — protects all `/v1/admin/*` endpoints |
| `EMAIL_PROVIDER` | No | Email provider (default `mailgun`; only `mailgun` supported today) |
| `EMAIL_FROM` | No | Bare sender email address, e.g. `comprobantes@mg.yourdomain.com`. Display name is built dynamically as `{Issuer Business Name} via Comprobify <EMAIL_FROM>`. |
| `MAILGUN_API_KEY` | No | Mailgun private API key |
| `MAILGUN_DOMAIN` | No | Mailgun sending domain, e.g. `mg.yourdomain.com` |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | No | From Mailgun dashboard → Sending → Webhooks → Webhook signing key |
| `SENTRY_DSN` | No | Sentry project DSN — enables error monitoring (`@sentry/node`). Leave unset to disable; the client becomes a no-op and nothing is transmitted. Set independently per environment — staging and production should point at the same Sentry project but report distinct `environment` tags (derived from `APP_ENV`). |

> **Issuer-specific config** (RUC, branch code, issue point, SRI environment, certificate) is stored per-issuer in the `issuers` database table via the Admin API. This enables multiple issuers to be configured independently without changing environment variables.

> **Email is optional at startup** — if `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` are unset the server starts normally. Email sends will fail at runtime and be recorded as `FAILED` in `documents.email_status`.

> **Webhook tracking is optional** — if `MAILGUN_WEBHOOK_SIGNING_KEY` is unset the webhook endpoint returns 401 for all requests. `email_status` stays at `SENT` permanently (no delivery confirmation).

Generate `ENCRYPTION_KEY`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## SRI environments

The SRI endpoint is determined at runtime by combining the `APP_ENV` variable with the per-tenant `sandbox` flag (`tenants.sandbox`). The `issuer.sandbox` field used in service code is a virtual field set by the `resolveIssuer` middleware — it reflects `tenant.sandbox`, not a column on `issuers`:

| `APP_ENV`    | `tenants.sandbox = true` | `tenants.sandbox = false` |
|---|---|---|
| `staging`    | SRI test endpoint, `ambiente = 1` | SRI test endpoint, `ambiente = 1` |
| `production` | SRI test endpoint, `ambiente = 1` | SRI production endpoint, `ambiente = 2` |

- **All tenants default to `sandbox = true`**. They will continue hitting the SRI test endpoint until explicitly promoted.
- **To promote a tenant to production:** use `POST /v1/tenants/promote` (tenant-authenticated, requires `ACTIVE` status) or `POST /v1/admin/tenants/:id/promote` (admin override). This flips `tenants.sandbox = false`, seeds production sequentials, and rotates API keys. Only do this on the `APP_ENV=production` deployment.
- `ambiente` is derived from the same logic and is embedded in both the 49-digit access key and the XML `infoTributaria/ambiente` field — it is never read directly from a DB column.

---

## Database migrations

Migrations are cumulative SQL files in `db/migrations/`, run by `db/migrate.js`.

**On deployed environments:** migrations run automatically at startup — `app.js` calls `migrate()` before the server begins accepting requests. Every deploy applies any pending migrations with no manual step required.

**Locally:**
```bash
npm run migrate
```

The runner tracks applied migrations in a `migrations` table — already-applied files are skipped. It is safe to run on every startup.

**Never modify an applied migration file.** Create a new numbered file instead.

**Manual rollback:** There is no automated rollback. To undo a migration, write a new migration that reverses the change and apply it.

---

## Certificate management

P12 certificates are uploaded via the Admin API (`POST /v1/admin/issuers`). The API extracts the private key and certificate PEM in-process (never written to disk), then stores them in the `issuers` table:

- `issuers.encrypted_private_key` — private key PEM encrypted with AES-256-GCM using `ENCRYPTION_KEY`
- `issuers.certificate_pem` — certificate PEM stored plaintext

The plaintext private key only exists in memory during the request and at signing time. No P12 file or plaintext private key is ever persisted to disk or the database.

To provision a new issuer:
```bash
curl -s -X POST https://api.comprobify.com/v1/admin/issuers \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -F "ruc=1700000000001" \
  -F "businessName=Acme S.A." \
  -F "branchCode=001" \
  -F "issuePointCode=001" \
  -F "environment=2" \
  -F "emissionType=1" \
  -F "certPassword=YOUR_P12_PASSWORD" \
  -F "cert=@/path/to/token.p12" | jq
```

See `GETTING_STARTED.md` for the full admin API reference.

---

## Production security checklist

- [ ] `APP_ENV=production` set on the production deployment; `APP_ENV=staging` on staging
- [ ] `DB_SSL=true` with a valid certificate
- [ ] Database user is **not** a PostgreSQL superuser — Row-Level Security is bypassed unconditionally for superusers
- [ ] App user has been granted privileges on the `sandbox` schema (see `GETTING_STARTED.md` step 7)
- [ ] `ENCRYPTION_KEY` is unique per environment — never share between staging and production
- [ ] `ADMIN_SECRET` is unique per environment and kept behind an internal firewall
- [ ] `.env` file is not world-readable and never committed
- [ ] `trust proxy: 1` set in `server.js` — required behind Cloudflare so IP-based rate limiters see the real client IP via `X-Forwarded-For`
- [ ] `helmet()` middleware active — sets standard security headers (`X-Content-Type-Options`, `Strict-Transport-Security`, `X-Frame-Options`, etc.)
- [ ] Tenants promoted to production (`tenants.sandbox = false`) only on the `APP_ENV=production` deployment — use `POST /v1/admin/tenants/:id/promote`
- [ ] API is behind HTTPS — on Render this is handled automatically; custom domain TLS cert issued via Let's Encrypt
- [ ] PostgreSQL not exposed on a public port
- [ ] `xmllint` installed on the server (`apt install libxml2-utils`)
- [ ] `EMAIL_FROM`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` set and verified against a real Mailgun domain (not sandbox)
- [ ] Mailgun sandbox authorized-recipient restriction removed (sandbox only allows pre-approved addresses)
- [ ] `MAILGUN_WEBHOOK_SIGNING_KEY` set and webhook URL registered in Mailgun dashboard for all 4 event types
- [ ] Webhook endpoint (`/v1/mailgun/webhook`) reachable on the public HTTPS URL
- [ ] Log aggregation configured — the API logs to stdout
- [ ] `SENTRY_DSN` set on staging and production so unexpected `5xx` errors are reported (left unset locally so development never sends events)

---

## Logs

The application logs to **stdout** only. No log files are written to disk.

Key log lines to monitor:

| Message | Meaning |
|---------|---------|
| `Server running on port N` | Startup succeeded |
| `SRI fetch attempt N failed, retrying in Nms` | Transient SRI network failure — being retried |
| `Unexpected database pool error` | DB connection issue — check PostgreSQL |
| `Failed to upsert client record` | Non-critical — buyer catalogue update failed |
| `Invoice email failed: ...` | Non-critical — email send failed; `email_status` set to `FAILED`, retry via `POST /v1/documents/:key/email-retry` |
| `Unhandled error: ...` | Unexpected error — inspect stack trace |

**Sentry** complements stdout logging: every response with `statusCode >= 500` is automatically reported to the configured `SENTRY_DSN` project (tagged `staging` / `production` via `environment`), with a full stack trace and request context — searchable and alertable without grepping log output. See the "Error monitoring (Sentry)" entry under Key Patterns in `../CLAUDE.md`.

---

## Health check

```bash
curl -s http://localhost:8080/health
# → {"status":"ok","uptime":42.3}         ← server up, DB connected
# → {"status":"error","uptime":42.3}      ← server up, DB unreachable (HTTP 503)
```

No authentication required. Suitable for load balancer health checks and container liveness probes. A connection refusal indicates the process is down.
