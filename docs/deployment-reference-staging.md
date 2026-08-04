# Comprobify Deployment Reference (Staging)

Last updated: 2026-07-30

This reference describes the staging deployment setup for Comprobify, including infrastructure, required configuration, deployment steps, and post-deployment checks. For the full CI/CD walkthrough, branching model, and env var reference, see `docs/deployment.md`. For the complete Terraform/DigitalOcean mechanics, see `docs/terraform-digitalocean-setup.md`.

## Architecture

- **Terraform** provisions the infrastructure: one DigitalOcean droplet (`comprobify-staging`), its firewall, a dedicated SSH key, and a Cloudflare DNS record. State is stored remotely in a DigitalOcean Spaces bucket (`comprobify-terraform-state`). A push to `main` touching `terraform/**` runs `terraform plan`/`apply` via `.github/workflows/terraform.yml`; this pipeline never triggers, and is never triggered by, the application deploy pipeline.
- **DigitalOcean** hosts the droplet itself — a plain Ubuntu 24.04 image (not a Marketplace image), with Docker installed and SSH hardened by cloud-init on first boot. A DigitalOcean Cloud Firewall restricts ports 80/443 to Cloudflare's published IP ranges; port 22 is open to the internet, with defense layered at the identity level instead: key-only auth, no root login, an unprivileged deploy user with no sudo, and fail2ban.
- **GitHub Actions** manages application CI/CD: a `vX.Y.Z` tag push runs `release-staging.yml`, which fast-forwards the `staging` branch to the tag; the resulting push to `staging` triggers `deploy-staging.yml`, which builds the Docker image, pushes it to GHCR, and deploys it to the droplet over SSH. Docs publishing is a separate workflow, `docs.yml`, deploying from `main` on changes under `docs/site/**`.
- **GHCR** (GitHub Container Registry) stores the built image at `ghcr.io/novaej/comprobify`, tagged with the deploying commit SHA.
- **Docker Compose** (`deploy/docker-compose.yml`, pushed to the droplet on every deploy) runs three containers: `caddy` (reverse proxy, the only container with ports exposed to the internet), `api` (`node app.js`), and `worker` (`node workers/worker.js`) — `api` and `worker` share the same image, differing only in `command`.
- **Caddy** terminates TLS, automatically obtaining and renewing a Let's Encrypt certificate for `api-staging.comprobify.com`, and reverse-proxies to the `api` container internally.
- **DigitalOcean Managed Postgres** provides the PostgreSQL database, with two schemas: `public` and `sandbox`. The cluster is shared with `comprobify-web` (not comprobify-only) and is not provisioned by this repo's Terraform — it's grouped into the same DO Project as the droplet for dashboard purposes only.
- **Cloudflare Pages** hosts the VitePress documentation site at `docs.comprobify.com`, project `comprobify-docs`, built via `npm run docs:build` and deployed with Wrangler.
- Four scheduled admin jobs run via a `cron.d` file (`/etc/cron.d/comprobify-jobs`) written to the droplet by cloud-init at first boot: Notifications every 5 minutes, Subscriptions daily, Quota daily, and Queue Reconciliation every 5 minutes (tightened from hourly since self-hosted cron has no per-invocation cost — see `docs/deployment.md`'s "Scheduled jobs" section). Each entry runs `docker compose exec -T api node scripts/run-admin-job.js <path>` directly inside the running `api` container — no Node install on the bare host, and `ADMIN_SECRET` is picked up automatically from that container's own `.env`.
- **CloudAMQP** provides the RabbitMQ broker backing the fully asynchronous document send/authorize pipeline (ADR-019) and, via the `pending_effects` outbox (ADR-022), every other async side effect: notifications, webhook fan-out, subscription hooks, and transactional emails. `POST /:key/send` and `GET /:key/authorize` only queue a message and return 202; the worker container performs the actual SRI call. Three queues back this: `sri.send`, `sri.authorize`, and `app.effects`.
- The **worker container** (`node workers/worker.js`) is the only process that calls SRI directly. It's a persistent process (not a scheduled job) consuming all three queues on one shared confirm channel.
- **Mailgun** handles transactional email through the configured `mg.<domain>` setup, with inbound delivery-event webhooks verified via HMAC-SHA256.
- **Sentry** provides error monitoring, with the environment tagged `staging`. Only 5xx responses are reported. The worker container also reports to Sentry (it requires `instrument.js` too).
- **Cloudflare** provides DNS and reverse-proxy/CDN for `api-staging.comprobify.com`, pointed at the droplet's IP by Terraform's `cloudflare_record` resource, and for `comprobify.com`.

---

## Components and Platforms

| Component | Platform | Service / Project name |
|---|---|---|
| Compute (API + worker + proxy) | DigitalOcean Droplet | `comprobify-staging` — `s-1vcpu-512mb-10gb`, region `nyc1`, Ubuntu 24.04 |
| Infrastructure-as-code | Terraform | `terraform/environments/staging`, state in DO Spaces bucket `comprobify-terraform-state` |
| Container registry | GHCR | `ghcr.io/novaej/comprobify` |
| Database | DigitalOcean Managed Database | Managed Postgres cluster, `public` + `sandbox` schemas — shared with `comprobify-web`, non-superuser app role required for RLS |
| Frontend | DigitalOcean App Platform | `comprobify-web` — moved off Vercel |
| Message broker | CloudAMQP | `shared-broker` — AWS `us-east-1`, one vhost (free tier) |
| Docs site | Cloudflare Pages | `comprobify-docs` — deployed from `main` via `docs.yml` |
| Scheduled jobs | `cron.d` on the droplet | `/etc/cron.d/comprobify-jobs`, written by cloud-init — four jobs (see schedule table below) |
| Email | Mailgun | Domain: `mg.comprobify.com` |
| Error monitoring | Sentry | `comprobify` — `environment=staging` tag |
| DNS / proxy | Cloudflare | Domain: `comprobify.com` — `api-staging.comprobify.com` → droplet IP (A record, proxied, Terraform-managed) |
| App CI/CD | GitHub Actions | `comprobify` repo — `release-staging.yml`, `deploy-staging.yml` |
| Infra CI/CD | GitHub Actions | `comprobify` repo — `terraform.yml` |
| DO Project | DigitalOcean (dashboard) | `Comprobify Staging` — groups the droplet, the App Platform app, and the Managed Database together (organizational only, not a security boundary) |

---

## DigitalOcean — droplet (`comprobify-staging`)

Provisioned by Terraform (`terraform/environments/staging`, using the shared `terraform/modules/droplet` module). Baseline configuration:

| Setting | Value |
|---|---|
| Droplet name | `comprobify-staging` |
| Region | `nyc1` (moved from `nyc3` to match `comprobify-web`'s App Platform app, which only runs in `nyc1`) |
| Size | `s-1vcpu-512mb-10gb` |
| Base image | `ubuntu-24-04-x64` (plain distribution image, not a Marketplace image) |
| Deploy user | `cpfydeploy9x` (unprivileged — docker group only, no sudo, no root SSH login) |
| Firewall | 80/443 restricted to Cloudflare's published IPv4 ranges; 22 open to `0.0.0.0/0` (defense layered at the identity level instead — see `docs/terraform-digitalocean-setup.md`'s "SSH access model") |
| Provisioning | cloud-init on first boot only — installs Docker Engine + Compose plugin, hardens sshd, enables fail2ban and unattended-upgrades, writes the `cron.d` schedule |
| DigitalOcean Project | `Comprobify Staging` (dashboard grouping only, not a security boundary — also holds `comprobify-web`'s App Platform app and the shared Managed Postgres database, neither provisioned by this repo's Terraform) |

### Terraform state backend

| Setting | Value |
|---|---|
| Backend | S3-compatible, DigitalOcean Spaces |
| Endpoint | `https://nyc3.digitaloceanspaces.com` (deliberately still `nyc3` — matches the existing Spaces bucket's region, independent of the droplet's `nyc1`) |
| Bucket | `comprobify-terraform-state` |
| State key | `staging/terraform.tfstate` |

---

## Docker Compose stack (on the droplet)

`deploy/docker-compose.yml` and `deploy/Caddyfile` are pushed to `/opt/comprobify` on every deploy (via scp), then started/updated with `docker compose pull && docker compose up -d`.

| Service | Image | Command | Exposed |
|---|---|---|---|
| `caddy` | `caddy:2-alpine` | (default) | 80, 443 → internet |
| `api` | `ghcr.io/novaej/comprobify:${IMAGE_TAG}` | `node app.js` | 8080 → internal (`expose`, not `ports`) — reachable only from `caddy` |
| `worker` | `ghcr.io/novaej/comprobify:${IMAGE_TAG}` | `node workers/worker.js` | none — outbound only (RabbitMQ, Postgres) |

`api` and `worker` run the **same image**, built once per deploy from the repo's `Dockerfile` (`node:20-slim`, `libxml2-utils` installed at build time for `xmllint`), differing only in the container `command`.

Caddy config (`deploy/Caddyfile`):

```
api-staging.comprobify.com {
    reverse_proxy api:8080
}
```

Caddy obtains/renews its Let's Encrypt certificate automatically on first request — no manual TLS configuration.

---

## GitHub — Environments and Secrets

Three separate scopes are in play: the `staging` Environment (app deploy secrets/variables, read by `deploy-staging.yml`), the `staging-infra` Environment (Terraform credentials, read by `terraform.yml`), and repository-level secrets (not environment-scoped).

### GitHub Environment: `staging` — Secrets

Written into `/opt/comprobify/.env` on the droplet on every app deploy. `DB_SSL_CA` is required here now that staging's database is DigitalOcean Managed Postgres, which signs with a private CA.

Not a GitHub Secret, but also written into this same `.env` by the workflow itself: `SENTRY_RELEASE=${{ github.sha }}`. Without it, Sentry's release auto-detection has nothing to key off of inside a plain Docker container (it used to auto-detect via Render's `RENDER_GIT_COMMIT` env var before the DigitalOcean migration) — releases silently stopped showing up in Sentry after that move until this was added.

| Secret | Value |
|---|---|
| `DROPLET_IP` | |
| `INFRA_SSH_PRIVATE_KEY` | |
| `ENCRYPTION_KEY` | |
| `ADMIN_SECRET` | |
| `DB_HOST` | |
| `DB_PORT` | |
| `DB_NAME` | |
| `DB_USER` | |
| `DB_PASSWORD` | |
| `DB_SSL_CA` | |
| `MAILGUN_API_KEY` | |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | |
| `SENTRY_DSN` | |
| `BETTERSTACK_SOURCE_TOKEN` | |
| `RABBITMQ_URL` | |

### GitHub Environment: `staging` — Variables

| Variable | Value |
|---|---|
| `APP_ENV` | |
| `APP_BASE_URL` | |
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
| `OPERATOR_NAME` | |
| `OPERATOR_RUC` | |
| `OPERATOR_EMAIL` | |
| `OPERATOR_ADDRESS` | |

Not set at all (code-level defaults are correct as-is): `PORT`, `DOCS_BASE_URL`, `VERIFICATION_TOKEN_TTL_HOURS`, `SRI_TEST_BASE_URL`, `SRI_PROD_BASE_URL`, `RATE_LIMIT_WINDOW_MS`, `RABBITMQ_SRI_EXCHANGE`, `QUEUE_RECONCILE_*`, `PENDING_EFFECTS_MAX_ATTEMPTS`, `IVA_RATE` (must stay genuinely absent, not empty — see `docs/terraform-digitalocean-setup.md`'s env var reference table). `REDIS_URL` is a separate case — not a GitHub Secret/Variable at all, but not genuinely unset either: it's hardcoded directly into the deploy workflow's heredoc (`redis://redis:6379`, deterministic across environments) — see `docs/terraform-digitalocean-setup.md`'s env var reference table.

### GitHub Environment: `staging-infra` — Secrets

Read by `terraform.yml`'s plan/apply jobs only.

| Secret | Value |
|---|---|
| `DO_TOKEN` | |
| `CLOUDFLARE_TOKEN` | |

### Repository secrets (not environment-scoped)

| Secret | Value |
|---|---|
| `RELEASE_PUSH_TOKEN` | |
| `DOCS_CLOUDFLARE_API_TOKEN` | |
| `DOCS_CLOUDFLARE_ACCOUNT_ID` | |
| `TERRAFORM_SPACES_ACCESS_KEY_ID` | |
| `TERRAFORM_SPACES_SECRET_ACCESS_KEY` | |

---

## Scheduled jobs (`cron.d` on the droplet)

Written to `/etc/cron.d/comprobify-jobs` by cloud-init at first boot. Each entry runs as `cpfydeploy9x` (not root) and executes inside the already-running `api` container via `docker compose exec -T`:

| Job | Schedule | Command |
|---|---|---|
| Notifications | `*/5 * * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/notifications` |
| Subscriptions | `0 6 * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/subscriptions` |
| Quota | `10 6 * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/quota` |
| Queue Reconciliation | `*/5 * * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/queue-reconciliation` |

Output is tagged and forwarded to the system log (`logger -t comprobify-cron`) — monitor with `journalctl -t comprobify-cron` on the droplet. `scripts/run-admin-job.js` needs `API_BASE_URL` and `ADMIN_SECRET`; both are picked up from the `api` container's own `.env`, so nothing extra is configured for cron itself. Harmless no-op if a job fires before the first deploy or mid-redeploy (no `api` container to exec into yet).

If the schedule itself needs to change, `cloud-init.yaml.tftpl` must be edited and the droplet recreated — `user_data` only applies at first boot.

---

## Background worker (worker container)

Runs `node workers/worker.js` as a long-running process inside the same `deploy/docker-compose.yml` stack as `api` and `caddy` — not a separate droplet or platform service. It holds a persistent connection to RabbitMQ and continuously consumes `sri.send`, `sri.authorize`, and `app.effects`. It is the only code in the system that calls SRI directly (ADR-019), and also processes every other durably-queued async side effect (notifications, webhook fan-out, subscription/payment lifecycle emails, verification emails, agreement generation) via the `pending_effects` outbox (ADR-022).

It runs `validateCoreConfig()` at startup — a narrower set than the API's full `validateConfig()` (`DB_*`, `RABBITMQ_URL`, `MAILGUN_API_KEY`/`MAILGUN_DOMAIN`/`EMAIL_FROM`), since its message handlers never touch admin auth, certificate encryption, billing, or inbound webhook verification. It shares the same `.env` file as `api` on the droplet (both containers read `env_file: .env`), so no separate secret/variable set is maintained for it. Restart-on-crash is handled by Docker Compose's `restart: unless-stopped` policy.

---

## DigitalOcean Managed Postgres — Database setup

The application database user must not be a superuser (or the provider's default admin role, e.g. DO's `doadmin`), because PostgreSQL row-level security is bypassed for superusers.

Run the following SQL via the database's SQL client (DO's control panel console, or `psql` against the cluster's connection string) after creating the cluster.

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

Because this cluster is shared with `comprobify-web`, confirm with whoever owns that project's schema/role plan before changing grants here — a change intended for comprobify's `public`/`sandbox` schemas should not accidentally widen or narrow access to whatever schema(s) `comprobify-web` uses on the same cluster.

---

## CloudAMQP — RabbitMQ setup

| Setting | Value |
|---|---|
| Instance name | `shared-broker` |
| Cloud provider / region | AWS, `us-east-1` |
| Plan | Free tier (Little Lemur) — one vhost/user per instance; no multi-environment isolation available on this plan |
| Vhost | Default instance vhost (free tier provisions exactly one) |

Both the `api` container (publisher) and the `worker` container (consumer) connect using the same `RABBITMQ_URL`. Connections are named via `clientProperties.connection_name` (`comprobify-api` / `comprobify-worker`) so they're distinguishable in CloudAMQP's Connections tab.

Three queues are declared (`src/services/queue.service.js`'s `QUEUES`): `sri.send`, `sri.authorize`, `app.effects`.

---

## Cloudflare Pages — `comprobify-docs`

| Setting | Value |
|---|---|
| Project name | `comprobify-docs` |
| Build command | `npm run docs:build` |
| Output directory | `docs/site/.vitepress/dist` |
| Branch | `main` (deploys on every push touching `docs/site/**`) |
| Custom domain | `docs.comprobify.com` |
| Deployed by | `docs.yml` via `cloudflare/wrangler-action` |

---

## Mailgun — Webhook registration

In the Mailgun dashboard, register the webhook below for these event types: `delivered`, `failed` (permanent and temporary), and `complained`.

```
POST https://api-staging.comprobify.com/v1/mailgun/webhook
```

---

## DNS (Cloudflare)

Managed by Terraform's `cloudflare_record` resource, part of the same apply that creates the droplet — no manual DNS step.

| Record | Type | Name | Target | Proxy |
|---|---|---|---|---|
| API | A | `api-staging` | Droplet's public IPv4 (`terraform output droplet_ip`) | On (proxied, ttl = 1) |
| Docs | CNAME | `docs` | Managed by Cloudflare Pages | Auto |

---

## Cloudflare configuration

`GET /v1/tenants/agreements/:type` serves personalized agreement HTML with real contact email addresses baked in. If Cloudflare's zone-wide Email Obfuscation is left on for a proxied API hostname, it rewrites those addresses into `<span data-cfemail="...">` placeholders backed by a relative `/cdn-cgi/l/email-protection` decode script — which 404s when `comprobify-web` fetches the HTML server-side and proxies it to the browser on a different domain, so addresses render as `[email protected]`.

A Configuration Rule disables obfuscation on just the API hostnames:

| Setting | Value |
|---|---|
| Zone | `comprobify.com` |
| Rule name | Disable Email Obfuscation - App subdomains |
| Expression | `(http.host eq "api.comprobify.com") or (http.host eq "api-staging.comprobify.com")` |
| Action | Email Obfuscation → Off |

Email Obfuscation stays on for `comprobify.com` / `staging.comprobify.com`, the marketing site, since it's still useful there. `app-staging.comprobify.com`, the frontend, now runs on DigitalOcean App Platform (moved off Vercel) — whether it needs adding to this rule depends on whether that hostname is Cloudflare-proxied: if App Platform serves it directly (unproxied), it's unaffected and needs no rule, same as before; if it's since been put behind Cloudflare, it should be added to the expression above. Verify current proxy status before assuming either way.

Full rationale is in `docs/deployment.md`'s "Cloudflare configuration" section and CLAUDE.md Common Mistake #33.

---

## System dependencies

`xmllint` is required for XSD validation and is bundled in the Docker image — installed via `apt-get install -y libxml2-utils` in the `Dockerfile` during the image build. No manual install step is needed on the droplet.

RabbitMQ is external infrastructure (CloudAMQP) — not an npm dependency. Both the `api` and `worker` containers connect to it as clients (`amqplib`).

The Postgres database is external infrastructure (DigitalOcean Managed Database) — not provisioned by this repo's Terraform.

Docker, fail2ban, unattended-upgrades, and cron are installed on the droplet itself by cloud-init at first boot — not part of the application image.

---

## Deployment flow

1. Create and push a release tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
2. `release-staging.yml` fast-forwards the `staging` branch to the tag and pushes it.
3. The push to `staging` triggers `deploy-staging.yml`, which builds the Docker image and pushes it to `ghcr.io/novaej/comprobify:<commit-sha>`.
4. `deploy-staging.yml` copies `deploy/docker-compose.yml` and `deploy/Caddyfile` to `/opt/comprobify` on the droplet over SCP, then SSHes in (as `cpfydeploy9x`) to write `/opt/comprobify/.env` from the `staging` Environment's Secrets/Variables and run `docker compose pull && docker compose up -d`.
5. Migrations run automatically inside the `api` container at startup — `app.js` calls `migrate()` before the server begins accepting requests. No separate migration step in the deploy workflow.
6. The scheduled jobs and worker deploy as part of the same Compose stack — there's no separate deploy path for them; they update whenever `api`/`worker` do.

---

## Post-deployment checks

```
curl -s https://api-staging.comprobify.com/health
# → {"status":"ok","uptime":...,"version":"0.10.1"}

curl -s https://api-staging.comprobify.com/v1/admin/tenants \
  -H "Authorization: Bearer $ADMIN_SECRET"
# → {"ok":true,"tenants":[...]}
```

- Confirm the deploy succeeded: `ssh cpfydeploy9x@<droplet-ip> "cd /opt/comprobify && docker compose logs api"` shows all pending migrations applied before the server starts accepting requests.
- Confirm all four cron jobs are running via `journalctl -t comprobify-cron` on the droplet. A missing or erroring entry usually means `ADMIN_SECRET` has drifted out of sync between the container's `.env` and what's expected, or the `api` container is down.
- Confirm the worker container is running (`docker compose ps`) and its logs show it consuming `sri.send`, `sri.authorize`, and `app.effects`; CloudAMQP's management UI should show non-zero consumers on all three queues.
- Confirm the Mailgun webhook is registered against the staging domain and pointed at `https://api-staging.comprobify.com/v1/mailgun/webhook`.
- Confirm agreement HTML renders real, non-obfuscated email addresses: `curl -s https://api-staging.comprobify.com/v1/agreements/TERMS | grep -o '\[email.*protected\]'` should return nothing.
- Queue a test document through `POST /:key/send`, confirm it reaches 202/`PENDING_SEND`, and confirm the worker moves it to `RECEIVED`/`RETURNED` shortly after.

---

Current deployed version: 0.10.1 (`package.json`, also surfaced at `GET /health`'s `version` field). See `docs/deployment.md` for the full branching strategy and release process, and `docs/terraform-digitalocean-setup.md` for infrastructure day-2 operations (resize, destroy/recreate, SSH key rotation).
