# Comprobify Deployment Reference (Production)

Last updated: 2026-09-09

**Status: NOT YET LIVE.** No production droplet has been provisioned yet — `terraform apply` for `terraform/environments/production` hasn't run. The `production`/`production-infra` GitHub Environments, their secrets/variables, and the `release-production.yml`/`deploy-production.yml` triggers are all already set up and enabled; the remaining gap is purely the infrastructure itself (droplet, DB cluster, DNS record) and the deployment-specific credentials that depend on it existing (`DROPLET_IP`, Payphone's production application). This document describes the **target configuration** for the production deployment — infrastructure, required configuration, deployment steps, and post-deployment checks. See `docs/production-readiness-checklist.md` for exactly what's done versus still pending. For the full CI/CD walkthrough, branching model, and env var reference, see `docs/deployment.md`. For the complete Terraform/DigitalOcean mechanics, see `docs/terraform-digitalocean-setup.md`.

## Architecture

- **Terraform** provisions the infrastructure: one DigitalOcean droplet (`comprobify-production`), its firewall, a dedicated SSH key, and a Cloudflare DNS record. State is stored remotely in a DigitalOcean Spaces bucket (`comprobify-terraform-state`). A push to `main` touching `terraform/**` runs `terraform plan`/`apply` for this environment via `.github/workflows/terraform.yml`'s `plan-production`/`apply-production` job pair; this pipeline never triggers, and is never triggered by, the application deploy pipeline. Unlike some environments in this repo, this job pair carries no on/off toggle — it always applies, since production is meant to run continuously once live.
- **DigitalOcean** hosts the droplet itself — a plain Ubuntu 24.04 image (not a Marketplace image), with Docker installed and SSH hardened by cloud-init on first boot. A DigitalOcean Cloud Firewall restricts ports 80/443 to Cloudflare's published IP ranges; port 22 is open to the internet, with defense layered at the identity level instead: key-only auth, no root login, an unprivileged deploy user with no sudo, and fail2ban.
- **GitHub Actions** manages application CI/CD in two stages. A `vX.Y.Z` tag push runs `release-staging.yml` and promotes to staging for validation first. Reaching production is a separate, deliberate step: a **GitHub Release must be published** from that already-validated tag — `release-production.yml` triggers on `release: types: [published]`, not on the tag push itself — which fast-forwards the `production` branch to the released tag; the resulting push to `production` triggers `deploy-production.yml`, which builds the Docker image, pushes it to GHCR, and deploys it to the droplet over SSH. Publishing the Release is the explicit human approval gate between "validated in staging" and "shipped to production." A `workflow_dispatch` "break-glass" path on `release-production.yml` can promote a tag straight to production without a published Release, for a true emergency — documented as the hotfix path in `docs/deployment.md`.
- **GHCR** (GitHub Container Registry) stores the built image at `ghcr.io/novaej/comprobify`, tagged with the deploying commit SHA.
- **Docker Compose** (`deploy/docker-compose.yml`, pushed to the droplet on every deploy) runs four containers: `caddy` (reverse proxy, the only container with ports exposed to the internet), `api` (`node app.js`), `worker` (`node workers/worker.js`), and `redis` — `api` and `worker` share the same image, differing only in `command`.
- **Caddy** terminates TLS, automatically obtaining and renewing a Let's Encrypt certificate for `api.comprobify.com`, and reverse-proxies to the `api` container internally.
- **Redis** (`redis:7-alpine`, self-hosted in the same Compose stack, its own instance on this droplet) backs the shared `RedisStore` behind `writeLimiter`/`readLimiter`/`adminLimiter`/`registrationLimiter` (`src/middleware/rate-limit.js`) and `attempt-tracker.service.js`'s repeated-attempt detection — only `api` connects to it, `worker` never rate-limits. No persistence (`--save ""`, disposable short-window counters) and a hard 32MB `--maxmemory` cap. `REDIS_URL` is not a GitHub Secret/Variable — it's hardcoded into the deploy workflow's `.env` heredoc as `redis://redis:6379` (Compose's internal DNS name for the service).
- **DigitalOcean Managed Postgres** provides the PostgreSQL database on its **own dedicated cluster** — two schemas, `public` and `sandbox`. This cluster may in turn be shared with `comprobify-web`'s own production database if/when that's provisioned, grouped into the same DO Project as this droplet for dashboard purposes only. **Not yet provisioned.**
- **Cloudflare Pages** hosts the VitePress documentation site at `docs.comprobify.com`, project `comprobify-docs`, built via `npm run docs:build` and deployed with Wrangler — a single resource that serves error-code documentation regardless of which environment's API a reader arrived from.
- Five scheduled admin jobs run via a `cron.d` file (`/etc/cron.d/comprobify-jobs`) written to the droplet by cloud-init at first boot: Notifications every 5 minutes, Subscriptions daily, Quota daily, Queue Reconciliation every 5 minutes, and Payphone Reconciliation every 5 minutes. Each entry runs `docker compose exec -T api node scripts/run-admin-job.js <path>` directly inside the running `api` container — no Node install on the bare host, and `ADMIN_SECRET` is picked up automatically from that container's own `.env`.
- **CloudAMQP** provides the RabbitMQ broker backing the fully asynchronous document send/authorize pipeline and, via the `pending_effects` outbox, every other async side effect: notifications, webhook fan-out, subscription hooks, and transactional emails. `POST /:key/send` and `GET /:key/authorize` only queue a message and return 202; the worker container performs the actual SRI call. Three queues back this: `sri.send`, `sri.authorize`, and `app.effects`. **Not yet provisioned** — this needs its own instance/vhost, since CloudAMQP's free tier provisions exactly one vhost per instance with no multi-environment isolation, and every other credential in this system (SSH keys, Cloudflare tokens, DB creds, `ENCRYPTION_KEY`, `ADMIN_SECRET`, Payphone credentials) is kept strictly separate per environment. Whether that means a second free-tier instance or a paid plan isn't decided yet — resolve this before `RABBITMQ_URL` is set on the `production` GitHub Environment.
- The **worker container** (`node workers/worker.js`) is the only process that calls SRI directly. It's a persistent process (not a scheduled job) consuming all three queues on one shared confirm channel.
- **Mailgun** handles transactional email through the `mg.comprobify.com` sending domain, with inbound delivery-event webhooks verified via HMAC-SHA256. This domain isn't environment-specific; what production needs of its own is a separate webhook registration (see below) and removing whatever sandbox-recipient restriction currently limits sends.
- **Sentry** provides error monitoring, reporting into the same Sentry **project** every environment uses, distinguished only by the `environment` tag (`production`, derived from `APP_ENV`) — `SENTRY_DSN` is the same value everywhere, just set as its own independent secret on this Environment. Only 5xx responses are reported. The worker container also reports to Sentry (it requires `instrument.js` too).
- **Cloudflare** provides DNS and reverse-proxy/CDN for `api.comprobify.com`, pointed at the droplet's reserved IP by Terraform's `cloudflare_record` resource.

---

## Components and Platforms

| Component | Platform | Service / Project name |
|---|---|---|
| Compute (API + worker + proxy + Redis) | DigitalOcean Droplet | `comprobify-production` — `s-1vcpu-1gb`, region `nyc1`, Ubuntu 24.04 (revisit sizing once real production traffic volume is known) |
| Infrastructure-as-code | Terraform | `terraform/environments/production`, state in DO Spaces bucket `comprobify-terraform-state`, key prefix `production/` |
| Container registry | GHCR | `ghcr.io/novaej/comprobify` |
| Database | DigitalOcean Managed Database | **Not yet provisioned** — own dedicated cluster, `public` + `sandbox` schemas, non-superuser app role required for RLS |
| Message broker | CloudAMQP | **Not yet provisioned** — needs its own instance/vhost (see Architecture above) |
| Docs site | Cloudflare Pages | `comprobify-docs` — a shared resource, not tied to this environment |
| Scheduled jobs | `cron.d` on the droplet | `/etc/cron.d/comprobify-jobs`, written by cloud-init — five jobs (see schedule table below) |
| Email | Mailgun | Domain: `mg.comprobify.com` |
| Error monitoring | Sentry | `comprobify` — `environment=production` tag |
| DNS / proxy | Cloudflare | Domain: `comprobify.com` — `api.comprobify.com` → droplet's reserved IP (A record, proxied, Terraform-managed) |
| App CI/CD | GitHub Actions | `comprobify` repo — `release-production.yml`, `deploy-production.yml` (both enabled; will fail on their first real run until the droplet is provisioned) |
| Infra CI/CD | GitHub Actions | `comprobify` repo — `terraform.yml`'s `plan-production`/`apply-production` job pair |
| DO Project | DigitalOcean (dashboard) | `Comprobify Production` — **not yet created**; looked up by name in Terraform, never created by it |

---

## DigitalOcean — droplet (`comprobify-production`)

Provisioned by Terraform (`terraform/environments/production`, using the shared `terraform/modules/droplet` module). Baseline configuration, from `terraform/environments/production/terraform.tfvars`:

| Setting | Value |
|---|---|
| Droplet name | `comprobify-production` |
| Region | `nyc1` |
| Size | `s-1vcpu-1gb`, 10GB disk (`resize_disk = false` on the droplet resource keeps a `droplet_size` change from also growing disk — see `docs/terraform-digitalocean-setup.md`'s "Resize" section) |
| Base image | `ubuntu-24-04-x64` (plain distribution image, not a Marketplace image) |
| Deploy user | `cpfydeploy4c7a` (unprivileged — docker group only, no sudo, no root SSH login) |
| Firewall | 80/443 restricted to Cloudflare's published IPv4 ranges; 22 open to `0.0.0.0/0` (defense layered at the identity level instead — see `docs/terraform-digitalocean-setup.md`'s "SSH access model") |
| Provisioning | cloud-init on first boot only — installs Docker Engine + Compose plugin, hardens sshd, enables fail2ban and unattended-upgrades, writes the `cron.d` schedule |
| DigitalOcean Project | `Comprobify Production` — **not yet created** in the DO dashboard; `terraform apply` will fail the project-lookup step until it exists |

### Terraform state backend

| Setting | Value |
|---|---|
| Backend | S3-compatible, DigitalOcean Spaces |
| Endpoint | `https://nyc3.digitaloceanspaces.com` — the Spaces bucket's region, independent of the droplet's own `nyc1` region |
| Bucket | `comprobify-terraform-state` |
| State key | `production/comprobify/terraform.tfstate` |

---

## Docker Compose stack (on the droplet)

`deploy/docker-compose.yml` and `deploy/caddy/Caddyfile` are pushed to `/opt/comprobify` on every deploy (via scp), then started/updated with `docker compose pull && docker compose up -d`.

| Service | Image | Command | Exposed |
|---|---|---|---|
| `caddy` | `caddy:2-alpine` | (default) | 80, 443 → internet |
| `api` | `ghcr.io/novaej/comprobify:${IMAGE_TAG}` | `node app.js` | 8080 → internal (`expose`, not `ports`) — reachable only from `caddy` |
| `worker` | `ghcr.io/novaej/comprobify:${IMAGE_TAG}` | `node workers/worker.js` | none — outbound only (RabbitMQ, Postgres) |
| `redis` | `redis:7-alpine` | `redis-server --maxmemory 32mb --maxmemory-policy allkeys-lru --save ""` | 6379 → internal (`expose`) — reachable only from `api` |

`api` and `worker` run the **same image**, built once per deploy from the repo's `Dockerfile` (`node:20-slim`, `libxml2-utils` installed at build time for `xmllint`), differing only in the container `command`. `api` declares `depends_on: redis: condition: service_healthy`, gated on `redis`'s own `healthcheck` (`redis-cli ping`) — not the plain list form, which only waits for the container to start, not for Redis to actually accept connections; `worker` never connects to it. Both `api` and `worker` also set a `hostname` (`comprobify-api-production` / `comprobify-worker-production`) read by `logger.service.js`'s `os.hostname()` call, so log lines are distinguishable from every other environment shipping to the same log destination.

Caddy config (`deploy/caddy/Caddyfile` — a directory mount, not a single-file mount, so a redeployed file is actually visible to the running container; see the comment on `caddy`'s `volumes` in `docker-compose.yml`). The site address is `{$PUBLIC_DOMAIN}` — Caddy's own env-var substitution, fed by the `PUBLIC_DOMAIN` GitHub Environment Variable (see below) — shown below resolved to production's actual value:

```
{
    servers {
        trusted_proxies static <cloudflare ranges>
        client_ip_headers CF-Connecting-IP X-Forwarded-For
    }
}

api.comprobify.com {
    reverse_proxy api:8080 {
        header_up X-Real-Client-IP {client_ip}
    }
}
```

Caddy obtains/renews its Let's Encrypt certificate automatically on first request — no manual TLS configuration.

---

## GitHub — Environments and Secrets

Four separate scopes are in play: the `production` Environment (app deploy secrets/variables, read by `deploy-production.yml`), the `production-infra` Environment (Terraform credentials, read by `terraform.yml`), repository-level secrets, and repository-level variables (the latter two not environment-scoped). Both Environments are set up with their required-reviewer rules and most values in place — the exceptions are `DROPLET_IP` (nothing to point at until the droplet is provisioned) and `PAYPHONE_TOKEN`/`PAYPHONE_STORE_ID` (deliberately deferred, see below).

### GitHub Environment: `production` — Secrets

Written into `/opt/comprobify/.env` on the droplet on every app deploy. `DB_SSL_CA` is required here since production's database is DigitalOcean Managed Postgres, which signs with a private CA.

Not a GitHub Secret, but also written into this same `.env` by the workflow itself: `SENTRY_RELEASE=${{ github.sha }}`. Without it, Sentry's release auto-detection has nothing to key off of inside a plain Docker container.

| Secret | Value |
|---|---|
| `DROPLET_IP` | Set once the droplet is provisioned — the Terraform **`reserved_ip`** output, not `droplet_ip` |
| `INFRA_SSH_PRIVATE_KEY` | The private half of `comprobify_deploy_production` |
| `ENCRYPTION_KEY` | A freshly generated value — never the same value any other environment uses |
| `ADMIN_SECRET` | A freshly generated value — never the same value any other environment uses |
| `INTERNAL_SERVICE_SECRET` | Required at startup as of #208/ADR-035 — the API refuses to boot without it, and gates `POST /v1/register`/`/recover`/`/resend-verification`/the consuming `POST /v1/verify-email` to `comprobify-web`'s own server-side BFF only (`403 INTERNAL_SERVICE_ONLY` otherwise). A freshly generated value, but it must then be **coordinated** — not just generated — with `comprobify-web`'s own production deployment: both sides must hold the exact same value, or every registration/recovery attempt silently fails while the API itself boots fine. This is a harder blocker than the other secrets here — it can't be set unilaterally on this repo's side alone. |
| `DB_HOST` | Production's own dedicated Managed Postgres cluster |
| `DB_PORT` | |
| `DB_NAME` | |
| `DB_USER` | |
| `DB_PASSWORD` | Freshly generated credentials for the production cluster's non-superuser app role |
| `DB_SSL_CA` | Production's cluster signs with its own private CA once provisioned — a different cert than any other environment's cluster |
| `MAILGUN_API_KEY` | |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | |
| `SENTRY_DSN` | The same value as every other environment's — one shared Sentry project, distinguished only by the `environment` tag |
| `BETTERSTACK_SOURCE_TOKEN` | |
| `RABBITMQ_URL` | Production's own broker instance/vhost — see the CloudAMQP section below |
| `PAYPHONE_TOKEN` | **Only `OPERATOR_RUC` and the standard operational secrets above are set for production today — this and `PAYPHONE_STORE_ID` stay unset.** A Payphone application is bound to its registered domain, so production needs its own application, which requires KYC against the registered legal entity (currently blocked — see `docs/production-readiness-checklist.md`'s "Blocked on legal entity registration"). Until then, card endpoints return `503 PAYMENT_GATEWAY_NOT_CONFIGURED` and SPI bank transfer is unaffected — a supported launch state. |
| `PAYPHONE_STORE_ID` | Kept beside the token, configured together once the application exists |

### GitHub Environment: `production` — Variables

| Variable | Value |
|---|---|
| `APP_ENV` | **Must be `production`** — the code's own default is `staging`, so a missing value here would silently run as `staging` with no error |
| `APP_BASE_URL` | |
| `PUBLIC_DOMAIN` | `api.comprobify.com` — bare hostname (no scheme), consumed only by `caddy`'s Caddyfile, not the app itself |
| `DB_SSL` | |
| `EMAIL_FROM` | |
| `EMAIL_FROM_DOCUMENTS` | |
| `EMAIL_PROVIDER` | |
| `MAILGUN_DOMAIN` | |
| `BANK_TRANSFER_BANK_NAME` | |
| `BANK_TRANSFER_ACCOUNT_TYPE` | |
| `BANK_TRANSFER_ACCOUNT_NUMBER` | |
| `BANK_TRANSFER_ACCOUNT_HOLDER` | |
| `BANK_TRANSFER_IDENTIFICATION` | |
| `ADMIN_NOTIFICATION_EMAIL` | |
| `OPERATOR_NAME` | **Not set.** Used only by `agreement.service.js`'s `{{operador.*}}` legal-document token substitution — deferred until `AGREEMENTS_ENABLED` is actually turned on for production (blocked on legal entity registration, checklist item 37). |
| `OPERATOR_RUC` | **Set.** Read unconditionally on every document build — `base.builder.js`'s `buildAdditionalInfo()` writes it into every document's `RUC Proveedor` field, required by SRI Resolution NAC-DGERCGC26-00000027 for third-party invoicing providers. Nothing to do with the agreements feature, and not deferred the way `NAME`/`EMAIL`/`ADDRESS` are — `base.builder.js`'s own comment notes this can be the operator's own persona natural RUC, not necessarily a newly incorporated entity. |
| `OPERATOR_EMAIL` | **Not set** — see `OPERATOR_NAME` above. |
| `OPERATOR_ADDRESS` | **Not set** — see `OPERATOR_NAME` above. |
| `AGREEMENTS_ENABLED` | **Undecided** (checklist item 28). Leaving unset keeps legal documents enabled (requires TERMS/PRIVACY/DPA published, or `POST /v1/tenants/promote` 403s) — but that requires `OPERATOR_NAME`/`OPERATOR_EMAIL`/`OPERATOR_ADDRESS` above to be set first, or agreement generation/publishing substitutes empty strings into the `{{operador.*}}` tokens. Setting it to exactly `false` launches without Terms/Privacy/DPA and needs none of those three. |
| `BETTERSTACK_INGESTING_HOST` | Only needed if the Betterstack source's setup page shows a specific regional ingesting host rather than the shared default |
| `DOCS_BASE_URL` | `https://docs.comprobify.com` — the same value as every environment; a shared docs site, not independently generated |

Not set at all (code-level defaults are correct as-is): `PORT`, `VERIFICATION_TOKEN_TTL_HOURS`, `SRI_TEST_BASE_URL`, `SRI_PROD_BASE_URL`, `RATE_LIMIT_WINDOW_MS`, `RABBITMQ_SRI_EXCHANGE`, `QUEUE_RECONCILE_*`, `PENDING_EFFECTS_MAX_ATTEMPTS`, `IVA_RATE` (must stay genuinely absent, not empty — see `docs/terraform-digitalocean-setup.md`'s env var reference table), `SRI_MOCK_MODE` (structurally inert once `APP_ENV=production` even if set by mistake, but should never be intentionally set here regardless). `REDIS_URL` is a separate case — not a GitHub Secret/Variable at all, but not genuinely unset either: it's hardcoded directly into the deploy workflow's heredoc (`redis://redis:6379`).

### GitHub Environment: `production-infra` — Secrets

Read by `terraform.yml`'s `plan-production`/`apply-production` jobs only.

| Secret | Value |
|---|---|
| `DO_TOKEN` | The `comprobify-terraform-production` token |
| `CLOUDFLARE_TOKEN` | The `comprobify-terraform-production` Cloudflare token |

**Set up this Environment's required-reviewer rule before adding real credentials to it, not after** (checklist item 17) — so no window exists where production infra secrets sit ungated.

### Repository secrets (not environment-scoped)

| Secret | Value |
|---|---|
| `RELEASE_PUSH_TOKEN` | |
| `DOCS_CLOUDFLARE_API_TOKEN` | |
| `DOCS_CLOUDFLARE_ACCOUNT_ID` | |
| `TERRAFORM_SPACES_ACCESS_KEY_ID` | One Spaces key pair, shared across every environment's Terraform state — isolation comes from the state key prefix, not separate credentials |
| `TERRAFORM_SPACES_SECRET_ACCESS_KEY` | |

**No `STAGING_INFRA_ENABLED`-equivalent repository variable exists or is needed for production** — `plan-production`/`apply-production` carry no such gate.

---

## Scheduled jobs (`cron.d` on the droplet)

Written to `/etc/cron.d/comprobify-jobs` by cloud-init at first boot. Each entry runs as `cpfydeploy4c7a` (not root) and executes inside the already-running `api` container via `docker compose exec -T`:

| Job | Schedule | Command |
|---|---|---|
| Notifications | `*/5 * * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/notifications` |
| Subscriptions | `0 6 * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/subscriptions` |
| Quota | `10 6 * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/quota` |
| Queue Reconciliation | `*/5 * * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/queue-reconciliation` |
| Payphone Reconciliation | `*/5 * * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/payphone-reconciliation` |

Each entry writes to its own plain log file — `/opt/comprobify/logs/cron-<name>.log`, prefixed per-run with an ISO timestamp (`date -Is`) — not `logger`/syslog: root SSH is fully disabled on this box, and reading the systemd journal needs root or the `systemd-journal` group, neither of which the unprivileged deploy user has. Monitor with `tail -100 /opt/comprobify/logs/cron-notifications.log` (swap in `-subscriptions`/`-quota`/`-queue-reconciliation`/`-payphone-reconciliation`; `tail -f` to follow live) on the droplet, or all five at once with `tail -n 50 /opt/comprobify/logs/cron-*.log`. Rotated weekly, 4 weeks kept, via `/etc/logrotate.d/comprobify-cron`. `scripts/run-admin-job.js` needs `API_BASE_URL` and `ADMIN_SECRET`; both are picked up from the `api` container's own `.env`, so nothing extra is configured for cron itself. Harmless no-op if a job fires before the first deploy or mid-redeploy (no `api` container to exec into yet).

**Do verify all five are present after the first production deploy** — the count is easy to leave stale, and a job that exists but was never scheduled fails silently and indefinitely. If the schedule itself needs to change, `cloud-init.yaml.tftpl` must be edited and the droplet recreated — `user_data` only applies at first boot.

---

## Background worker (worker container)

Runs `node workers/worker.js` as a long-running process inside the same `deploy/docker-compose.yml` stack as `api` and `caddy` — not a separate droplet or platform service. It holds a persistent connection to RabbitMQ and continuously consumes `sri.send`, `sri.authorize`, and `app.effects`. It is the only code in the system that calls SRI directly, and also processes every other durably-queued async side effect (notifications, webhook fan-out, subscription/payment lifecycle emails, verification emails, agreement generation) via the `pending_effects` outbox.

It runs `validateCoreConfig()` at startup — a narrower set than the API's full `validateConfig()` (`DB_*`, `RABBITMQ_URL`, `MAILGUN_API_KEY`/`MAILGUN_DOMAIN`/`EMAIL_FROM`), since its message handlers never touch admin auth, certificate encryption, billing, or inbound webhook verification. It shares the same `.env` file as `api` on the droplet (both containers read `env_file: .env`), so no separate secret/variable set is maintained for it. Restart-on-crash is handled by Docker Compose's `restart: unless-stopped` policy.

---

## DigitalOcean Managed Postgres — Database setup

**Not yet provisioned.** The application database user must not be a superuser (or the provider's default admin role, e.g. DO's `doadmin`), because PostgreSQL row-level security is bypassed for superusers.

Once the cluster exists, run the following SQL via its SQL client (DO's control panel console, or `psql` against the cluster's connection string).

**Step 1** — Create the application role and grant baseline access:

```sql
CREATE ROLE comprobify_app LOGIN PASSWORD 'FILL_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE defaultdb TO comprobify_app;
GRANT ALL ON SCHEMA public TO comprobify_app;
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO comprobify_app;
ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO comprobify_app;
```

(`defaultdb` is DigitalOcean Managed Postgres's default database name — adjust if the cluster was provisioned with a different one.)

**Step 2** — After the first deployment, grant access to the `sandbox` schema created by migration 033:

```sql
GRANT ALL ON SCHEMA sandbox TO comprobify_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA sandbox GRANT ALL ON TABLES TO comprobify_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA sandbox GRANT ALL ON SEQUENCES TO comprobify_app;
```

If this cluster ends up shared with `comprobify-web`'s own production database, confirm with whoever owns that project's schema/role plan before changing grants — a change intended for comprobify's `public`/`sandbox` schemas should not accidentally widen or narrow access to whatever schema(s) `comprobify-web` uses on the same cluster.

---

## CloudAMQP — RabbitMQ setup

**Not yet provisioned.** Needs its own instance/vhost, separate from every other environment's broker — CloudAMQP's free tier provisions exactly one vhost per instance with no multi-environment isolation, so this can't simply be a second vhost added to an existing free-tier instance. Whether that means a second free-tier instance or a paid plan isn't decided yet.

Once provisioned, the connection shape: both the `api` container (publisher) and the `worker` container (consumer) connect using the same `RABBITMQ_URL`, with connections named via `clientProperties.connection_name` (`comprobify-api` / `comprobify-worker`) so they're distinguishable in CloudAMQP's Connections tab. Three queues are declared (`src/services/queue.service.js`'s `QUEUES`): `sri.send`, `sri.authorize`, `app.effects`.

---

## Mailgun — Webhook registration

In the Mailgun dashboard, register the webhook below for these event types: `delivered`, `failed` (permanent and temporary), and `complained`.

```
POST https://api.comprobify.com/v1/mailgun/webhook
```

Also remove whatever sandbox-recipient restriction currently limits sends on the sending domain — production needs to be able to email real tenant addresses (checklist item 25).

---

## DNS (Cloudflare)

Managed by Terraform's `cloudflare_record` resource, part of the same `apply` that creates the droplet — no manual DNS step.

| Record | Type | Name | Target | Proxy |
|---|---|---|---|---|
| API | A | `api` | Droplet's reserved IPv4 (`terraform output reserved_ip`) | On (proxied, ttl = 1) |

(The docs subdomain's CNAME is a single repo-wide DNS record pointed at Cloudflare Pages — not tied to any one environment's droplet, so it isn't provisioned per environment.)

---

## Cloudflare configuration

`GET /v1/tenants/agreements/:type` serves personalized agreement HTML with real contact email addresses baked in. If Cloudflare's zone-wide Email Obfuscation is left on for a proxied API hostname, it rewrites those addresses into `<span data-cfemail="...">` placeholders backed by a relative `/cdn-cgi/l/email-protection` decode script — which 404s when `comprobify-web` fetches the HTML server-side and proxies it to the browser on a different domain, so addresses render as `[email protected]`.

A Configuration Rule disables obfuscation on the API hostnames — `api.comprobify.com` is already included in its expression, so no additional Cloudflare setup is needed for production specifically once the rest of this checklist is done:

| Setting | Value |
|---|---|
| Zone | `comprobify.com` |
| Rule name | Disable Email Obfuscation - App subdomains |
| Expression | `(http.host eq "api.comprobify.com") or (http.host eq "api-staging.comprobify.com")` |
| Action | Email Obfuscation → Off |

Full rationale is in `docs/deployment.md`'s "Cloudflare configuration" section and CLAUDE.md Common Mistake #33.

---

## System dependencies

`xmllint` is required for XSD validation and is bundled in the Docker image — installed via `apt-get install -y libxml2-utils` in the `Dockerfile` during the image build. No manual install step is needed on the droplet.

RabbitMQ is external infrastructure (CloudAMQP) — not an npm dependency. Both the `api` and `worker` containers connect to it as clients (`amqplib`).

The Postgres database is external infrastructure (DigitalOcean Managed Database) — not provisioned by this repo's Terraform.

Docker, fail2ban, unattended-upgrades, and cron are installed on the droplet itself by cloud-init at first boot — not part of the application image.

---

## Deployment flow

1. A version tag (`vX.Y.Z`) is pushed and validated in staging via the normal tag → staging deploy pipeline first.
2. A GitHub Release is **published** from that already-validated tag — the explicit human approval step; `release-production.yml` triggers on `release: types: [published]`, not on the tag push itself.
3. `release-production.yml` fast-forwards the `production` branch to the released tag and pushes it.
4. The push to `production` triggers `deploy-production.yml`, which builds the Docker image and pushes it to `ghcr.io/novaej/comprobify:<commit-sha>`.
5. `deploy-production.yml` copies `deploy/docker-compose.yml` and `deploy/caddy/Caddyfile` to `/opt/comprobify` on the droplet over SCP, then SSHes in (as `cpfydeploy4c7a`) to write `/opt/comprobify/.env` from the `production` Environment's Secrets/Variables and run `docker compose pull && docker compose up -d`.
6. Migrations run automatically inside the `api` container at startup — `app.js` calls `migrate()` before the server begins accepting requests. No separate migration step in the deploy workflow.
7. The scheduled jobs and worker deploy as part of the same Compose stack — there's no separate deploy path for them; they update whenever `api`/`worker` do.

**Break-glass path:** `release-production.yml` also accepts a manual `workflow_dispatch` to promote a tag straight to production without a published Release — documented as the emergency-only hotfix path in `docs/deployment.md`, bypassing staging validation.

Both workflows are enabled — `release-production.yml` triggers on a published GitHub Release, `deploy-production.yml` on a push to `production`. Until the droplet is provisioned, a real trigger will run and fail at the SSH step (nothing to connect to) — that's expected, not a sign anything is misconfigured.

---

## Post-deployment checks

```
curl -s https://api.comprobify.com/health
# → {"status":"ok","uptime":...,"version":"0.16.5"}

curl -s https://api.comprobify.com/v1/admin/tenants \
  -H "Authorization: Bearer $ADMIN_SECRET"
# → {"ok":true,"tenants":[...]}
```

- Confirm the deploy succeeded: `ssh cpfydeploy4c7a@<droplet-ip> "cd /opt/comprobify && docker compose logs api"` shows all pending migrations applied before the server starts accepting requests.
- Confirm all five cron jobs are running via `tail -n 50 /opt/comprobify/logs/cron-*.log` on the droplet. A missing or erroring entry usually means `ADMIN_SECRET` has drifted out of sync between the container's `.env` and what's expected, or the `api` container is down.
- Confirm the worker container is running (`docker compose ps`) and its logs show it consuming `sri.send`, `sri.authorize`, and `app.effects`; CloudAMQP's management UI should show non-zero consumers on all three queues.
- Confirm the Mailgun webhook is registered against the production domain and pointed at `https://api.comprobify.com/v1/mailgun/webhook`.
- Confirm agreement HTML renders real, non-obfuscated email addresses: `curl -s https://api.comprobify.com/v1/agreements/TERMS | grep -o '\[email.*protected\]'` should return nothing. **Skip this check when `AGREEMENTS_ENABLED=false`** — that endpoint correctly returns `404 AGREEMENT_NOT_FOUND` when legal documents are switched off, which is not a Cloudflare obfuscation problem.
- Queue a test document through `POST /:key/send`, confirm it reaches 202/`PENDING_SEND`, and confirm the worker moves it to `RECEIVED`/`RETURNED` shortly after.
- **First-deploy-only:** onboard the first real tenant via comprobify-web, promote to production, and verify one real invoice against SRI's actual production endpoint (not the test endpoint every other environment uses) — checklist item 38.
- **First-deploy-only, once Payphone credentials exist:** verify one real card payment end-to-end against Payphone's live (non-sandbox) endpoint — checklist item 41.

---

Current deployed version is surfaced at `GET /health`'s `version` field (source: `package.json`). See `docs/deployment.md` for the full branching strategy and release process, `docs/terraform-digitalocean-setup.md` for infrastructure day-2 operations (resize, destroy/recreate, SSH key rotation), and `docs/production-readiness-checklist.md` for the authoritative, up-to-date list of what's done versus pending toward enabling this environment for real.
