# Deployment

---

## Branching strategy

Three long-lived branches map directly to environments. Feature branches are always cut from `main` and merged back into `main` via pull request.

```
  feature/xyz              main               staging                prod
      │                     │                    │                     │
      │  PR + merge         │                    │                     │
      │────────────────────▶│                    │                     │
      │                     │  merge main →      │                     │
      │                     │  staging           │                     │
      │                     │───────────────────▶│──▶ GitHub Actions ──▶ comprobify-staging
      │                     │                    │                     │
      │                     │  merge staging →   │                     │
      │                     │  prod (full release)                     │
      │                     │────────────────────┼────────────────────▶│──▶ GitHub Actions ──▶ comprobify-prod
      │                     │                    │                     │
      │                     │  cherry-pick       │                     │
      │                     │  (selective deploy)│                     │
      │                     │────────────────────┼── commit SHA ──────▶│──▶ GitHub Actions ──▶ comprobify-prod
      │                     │                    │                     │
  hotfix/xyz                │                    │                     │
      │  PR + merge         │                    │                     │
      │────────────────────▶│                    │                     │
      │                     │  cherry-pick       │                     │
      │                     │  to prod           │                     │
      │                     │────────────────────┼── commit SHA ──────▶│──▶ GitHub Actions ──▶ comprobify-prod
      │                     │                    │                     │
      │                     │  cherry-pick       │                     │
      │                     │  to staging (sync) │                     │
      │                     │───────────────────▶│                     │
```

| Branch | Environment | Trigger |
|--------|-------------|---------|
| `main` | Local / CI tests | — |
| `staging` | Staging (DigitalOcean) | Push to `staging` |
| `prod` | Production (DigitalOcean) | Push to `prod` |

**Rules:**
- All development work happens in `feature/*` branches off `main`
- Never commit directly to `staging` or `prod`
- Always flow commits **downward**: `main` → `staging` → `prod`
- For hotfixes: fix in `main` first, then cherry-pick to `prod`

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

### Deploy to staging

```bash
# Merge main into staging — triggers the staging deploy automatically
git checkout staging
git pull origin staging
git merge main
git push origin staging
git checkout main
```

### Deploy to production

```bash
# Full release: merge staging into prod
git checkout prod
git pull origin prod
git merge staging
git push origin prod

# Or: cherry-pick specific commits from main to prod
git checkout prod
git pull origin prod
git cherry-pick <commit-sha>   # repeat for each commit needed
git push origin prod
git checkout main
```

> **Cherry-pick caveat:** cherry-picked commits get a new SHA. If you later do a full `merge staging → prod`, git won't recognise them as already merged and may produce conflicts. To avoid this, after cherry-picking into prod always cherry-pick the same commits into staging so all three branches stay consistent. Periodically do a full merge from staging to prod to reset the debt.

### Sync after cherry-picking

```bash
# After cherry-picking to prod, keep staging consistent
git checkout staging
git cherry-pick <commit-sha>   # same commit(s)
git push origin staging
git checkout main
```

### Hotfix on production

```bash
# Always fix in main first
git checkout main
git pull origin main
git checkout -b hotfix/critical-fix
# fix, commit, push
git push origin hotfix/critical-fix
# PR → main, merge

# Then cherry-pick to prod (and staging to keep in sync)
git checkout prod
git pull origin prod
git cherry-pick <hotfix-commit-sha>
git push origin prod

git checkout staging
git pull origin staging
git cherry-pick <hotfix-commit-sha>
git push origin staging

git checkout main
```

---

## CI/CD pipeline

### Workflow files

| File | Trigger | Deploys to |
|------|---------|------------|
| `.github/workflows/deploy-staging.yml` | Push to `staging` | `comprobify-staging` (DigitalOcean App Platform) |
| `.github/workflows/deploy-production.yml` | Push to `prod` | `comprobify-prod` *(to be added)* |

### Pipeline stages (staging)

1. **Checkout** — fetch latest commit from `staging` branch
2. **Deploy** — authenticate to DigitalOcean with `DIGITALOCEAN_ACCESS_TOKEN` and trigger a new deployment of the `comprobify-staging` app

DigitalOcean App Platform handles the rest: installs dependencies (`npm ci`), runs the start command (`npm start`), and runs database migrations (`npm run migrate`) if configured as a pre-deploy job.

### Adding the production workflow

When ready, create `.github/workflows/deploy-production.yml` by copying `deploy-staging.yml` and changing only:
1. The workflow `name` to `Deploy to Production`
2. The `branches` trigger from `staging` to `prod`
3. The `app_name` from `comprobify-staging` to `comprobify-prod`

---

## GitHub repository setup

One-time setup after creating the `staging` and `prod` branches.

### 1. Create the branches

```bash
git checkout main
git pull origin main

git checkout -b staging
git push -u origin staging

git checkout main
git checkout -b prod
git push -u origin prod

git checkout main
```

### 2. Protect `main` (Settings → Branches → Add rule)

- **Branch name pattern:** `main`
- ✅ Require a pull request before merging
- ✅ Require approvals: 1
- ✅ Dismiss stale pull request approvals when new commits are pushed
- ✅ Do not allow bypassing the above settings

### 3. Protect `prod` (Settings → Branches → Add rule)

- **Branch name pattern:** `prod`
- ✅ Restrict who can push — add only yourself
- ✅ Do not allow force pushes

### 4. Leave `staging` open

`staging` does not need branch protection. Merges from `main` are fast and frequent. Direct push is fine.

### 5. Add secrets (Settings → Secrets and variables → Actions)

- `DIGITALOCEAN_ACCESS_TOKEN` — personal access token from DigitalOcean dashboard (API → Generate New Token, write scope). Used by both staging and production workflows.

### 6. DigitalOcean App Platform

- Create two apps: `comprobify-staging` (linked to `staging` branch) and `comprobify-prod` (linked to `prod` branch)
- Add all environment variables from the table below to each app's environment configuration
- Configure a pre-deploy job: `npm run migrate` — this runs migrations automatically on each deployment before traffic is switched

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
| `DB_HOST` | Yes | PostgreSQL host |
| `DB_PORT` | No | PostgreSQL port (default `5432`) |
| `DB_NAME` | Yes | Database name |
| `DB_USER` | Yes | Database user |
| `DB_PASSWORD` | Yes | Database password |
| `DB_SSL` | Yes | `true` to enable SSL (required in production) |
| `ENCRYPTION_KEY` | Yes | 64-character hex string — AES-256-GCM key for private key encryption |
| `ADMIN_SECRET` | Yes | 64-character hex string — protects all `/api/admin/*` endpoints |
| `EMAIL_PROVIDER` | No | Email provider (default `mailgun`; only `mailgun` supported today) |
| `EMAIL_FROM` | No | Bare sender email address, e.g. `comprobantes@mg.yourdomain.com`. Display name is built dynamically as `{Issuer Business Name} via Comprobify <EMAIL_FROM>`. |
| `MAILGUN_API_KEY` | No | Mailgun private API key |
| `MAILGUN_DOMAIN` | No | Mailgun sending domain, e.g. `mg.yourdomain.com` |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | No | From Mailgun dashboard → Sending → Webhooks → Webhook signing key |

> **Issuer-specific config** (RUC, branch code, issue point, SRI environment, certificate) is stored per-issuer in the `issuers` database table via the Admin API. This enables multiple issuers to be configured independently without changing environment variables.

> **Email is optional at startup** — if `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` are unset the server starts normally. Email sends will fail at runtime and be recorded as `FAILED` in `documents.email_status`.

> **Webhook tracking is optional** — if `MAILGUN_WEBHOOK_SIGNING_KEY` is unset the webhook endpoint returns 401 for all requests. `email_status` stays at `SENT` permanently (no delivery confirmation).

Generate `ENCRYPTION_KEY`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## SRI environments

The SRI endpoint is determined at runtime by combining the `APP_ENV` variable with the per-issuer `sandbox` flag:

| `APP_ENV`    | `issuers.sandbox = true` | `issuers.sandbox = false` |
|---|---|---|
| `staging`    | SRI test endpoint, `ambiente = 1` | SRI test endpoint, `ambiente = 1` |
| `production` | SRI test endpoint, `ambiente = 1` | SRI production endpoint, `ambiente = 2` |

- **All existing issuers default to `sandbox = true`** after migration 032. They will continue hitting the SRI test endpoint until explicitly promoted.
- **To promote an issuer to production:** update `issuers.sandbox = false` directly in the database (no API endpoint for this yet — admin-level operation). Only do this on the `APP_ENV=production` deployment.
- `ambiente` is derived from the same logic and is embedded in both the 49-digit access key and the XML `infoTributaria/ambiente` field — it is not read directly from `issuers.environment`.

---

## Database migrations

Migrations are cumulative SQL files in `db/migrations/`, run by `db/migrate.js`.

**Apply migrations:**
```bash
npm run migrate
```

The runner tracks applied migrations in a `migrations` table — already-applied files are skipped. It is safe to run on every deploy.

**Never modify an applied migration file.** Create a new numbered file instead.

**Manual rollback:** There is no automated rollback. To undo a migration, write a new migration that reverses the change and apply it.

---

## Certificate management

P12 certificates are uploaded via the Admin API (`POST /api/admin/issuers`). The API extracts the private key and certificate PEM in-process (never written to disk), then stores them in the `issuers` table:

- `issuers.encrypted_private_key` — private key PEM encrypted with AES-256-GCM using `ENCRYPTION_KEY`
- `issuers.certificate_pem` — certificate PEM stored plaintext

The plaintext private key only exists in memory during the request and at signing time. No P12 file or plaintext private key is ever persisted to disk or the database.

To provision a new issuer:
```bash
curl -s -X POST https://yourserver/api/admin/issuers \
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
- [ ] `issuers.sandbox` set to `false` only on issuer rows that are genuinely live on the production SRI system
- [ ] API is behind HTTPS (reverse proxy: nginx, Caddy, or load balancer TLS termination)
- [ ] PostgreSQL not exposed on a public port
- [ ] `xmllint` installed on the server (`apt install libxml2-utils`)
- [ ] `EMAIL_FROM`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` set and verified against a real Mailgun domain (not sandbox)
- [ ] Mailgun sandbox authorized-recipient restriction removed (sandbox only allows pre-approved addresses)
- [ ] `MAILGUN_WEBHOOK_SIGNING_KEY` set and webhook URL registered in Mailgun dashboard for all 4 event types
- [ ] Webhook endpoint (`/api/mailgun/webhook`) reachable on the public HTTPS URL
- [ ] Log aggregation configured — the API logs to stdout

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
| `Invoice email failed: ...` | Non-critical — email send failed; `email_status` set to `FAILED`, retry via `POST /api/documents/:key/email-retry` |
| `Unhandled error: ...` | Unexpected error — inspect stack trace |

---

## Health check

```bash
curl -s http://localhost:8080/health
# → {"status":"ok","uptime":42.3}         ← server up, DB connected
# → {"status":"error","uptime":42.3}      ← server up, DB unreachable (HTTP 503)
```

No authentication required. Suitable for load balancer health checks and container liveness probes. A connection refusal indicates the process is down.
