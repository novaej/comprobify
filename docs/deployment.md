# Deployment

---

## Branching strategy

Three long-lived branches map directly to environments. Feature branches are always cut from `main` and merged back into `main` via pull request.

```
main  ──►  staging  ──►  prod
 ▲
 │
feature/*  (short-lived, PR → main)
```

| Branch | Environment | How it gets updated |
|--------|-------------|---------------------|
| `main` | Local / CI tests | All feature PRs merge here |
| `staging` | Staging (DigitalOcean) | Merge `main` → `staging` manually |
| `prod` | Production (DigitalOcean) | Merge `staging` → `prod` manually (or cherry-pick) |

### Feature workflow

```bash
# 1. Start a feature
git checkout main && git pull
git checkout -b feature/my-feature

# 2. Work, commit, push
git add <files>
git commit -m "feat: describe the change"
git push -u origin feature/my-feature

# 3. Open a PR → main on GitHub, get review, merge

# 4. Clean up
git checkout main && git pull
git branch -d feature/my-feature
```

### Deploy to staging

```bash
git checkout staging
git merge main
git push
# GitHub Actions runs deploy-staging.yml → DigitalOcean App Platform (comprobify-staging)
git checkout main
```

### Deploy to production

```bash
git checkout prod
git merge staging
git push
# (production workflow — to be added in a future PR)
git checkout main
```

### Hotfix workflow

Always fix in `main` first, then forward-port. Never commit directly to `staging` or `prod`.

```bash
# 1. Fix in main
git checkout main && git pull
git checkout -b fix/critical-bug
# ... make the fix ...
git commit -m "fix: describe the fix"
git push -u origin fix/critical-bug
# PR → main, merge

# 2. Cherry-pick to prod (if the fix is urgent)
git checkout prod && git pull
git cherry-pick <commit-sha>
git push

# 3. Keep staging in sync
git checkout staging && git pull
git cherry-pick <commit-sha>
git push
git checkout main
```

> **Cherry-pick caveat:** cherry-picking creates a new commit SHA. When you later merge `main` → `staging` → `prod`, Git will see the fix as already applied (same diff) and skip it cleanly, but you may need to resolve minor conflicts if the surrounding code changed.

### GitHub repository setup

Perform these steps once after creating the `staging` and `prod` branches:

1. **Create branches:**
   ```bash
   git checkout -b staging && git push -u origin staging
   git checkout -b prod && git push -u origin prod
   git checkout main
   ```

2. **Branch protection (GitHub → Settings → Branches):**
   - `main`: require PR, require 1 approval, no direct push
   - `staging`: require PR or restrict to maintainers, no force-push
   - `prod`: require PR or restrict to maintainers, no force-push

3. **Secrets (GitHub → Settings → Secrets and variables → Actions):**
   - `DIGITALOCEAN_ACCESS_TOKEN` — personal access token from DigitalOcean dashboard (API → Generate New Token, write scope)

4. **DigitalOcean App Platform:**
   - Create two apps: `comprobify-staging` and `comprobify-prod`
   - Link each to the corresponding branch in your GitHub repo
   - Add all environment variables from the table below to each app's environment

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

The SRI endpoint is resolved per-issuer at runtime from `issuers.environment`:

| `issuers.environment` | SRI URLs used |
|----------------------|--------------|
| `1` (test) | `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/...` |
| `2` (production) | `https://cel.sri.gob.ec/comprobantes-electronicos-ws/...` |

**Never set `environment = '2'` on a test issuer row, or `environment = '1'` on a production issuer row.**

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

- [ ] `DB_SSL=true` with a valid certificate
- [ ] `ENCRYPTION_KEY` is unique per environment — never share between staging and production
- [ ] `ADMIN_SECRET` is unique per environment and kept behind an internal firewall
- [ ] `.env` file is not world-readable and never committed
- [ ] `issuers.environment` set to `2` only on production issuer rows
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

There is no dedicated `/health` endpoint yet (see `NEXT_STEPS.md`). A lightweight check:

```bash
curl -s http://localhost:8080/api/documents/0000000000000000000000000000000000000000000000000
# → {"ok":false,"message":"Document not found"}   ← server up, DB connected
```

A `500` response or connection refusal indicates a problem.
