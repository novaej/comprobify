# Comprobify Deployment Reference (Production)

Last updated: 2026-09-08

**Status: NOT YET LIVE.** No production droplet has been provisioned, no `production`/`production-infra` GitHub Environment secrets exist yet, and `release-production.yml`/`deploy-production.yml` are both still gated behind `if: false` with their triggers commented out. This document describes the **target configuration** — everything already decided and, in most cases, already written into the repo (Terraform module, workflow files, `terraform.tfvars`) — not a live system. See `docs/production-readiness-checklist.md` for exactly what's done versus still pending, and `docs/deployment.md`'s "Production status" section for the enablement steps. Mirrors `docs/deployment-reference-staging.md`'s structure; only the values that differ are called out — see that doc for anything not repeated here.

## Architecture

- **Terraform** provisions the infrastructure: one DigitalOcean droplet (`comprobify-production`), its firewall, a dedicated SSH key, and a Cloudflare DNS record — same shared `terraform/modules/droplet` module staging uses, instantiated from `terraform/environments/production` with its own state. A push to `main` touching `terraform/**` runs both `plan-staging`/`apply-staging` and `plan-production`/`apply-production` in the same `.github/workflows/terraform.yml` run (idempotent — an environment with no actual changes just reports "no changes"). Unlike staging, production's job pair carries **no `STAGING_INFRA_ENABLED`-style gate** — it always applies, since production is meant to run continuously once live, not be torn down between uses (see `docs/terraform-digitalocean-setup.md`'s "Toggling staging infra on/off").
- **DigitalOcean** hosts the droplet itself — same base image and cloud-init hardening as staging (plain Ubuntu 24.04, Docker installed and SSH hardened on first boot, port 22 open to the internet with identity-layer defense instead of IP restriction — see `docs/terraform-digitalocean-setup.md`'s "SSH access model").
- **GitHub Actions** manages application CI/CD, but the promotion mechanism differs from staging's: a `vX.Y.Z` tag push alone only promotes to `staging` (`release-staging.yml`, fully automatic). Reaching production additionally requires a **GitHub Release to be published** from that tag — `release-production.yml` triggers on `release: types: [published]`, not on the tag push itself, and fast-forwards the `production` branch to the released tag; the resulting push to `production` triggers `deploy-production.yml`. Publishing the Release is the deliberate manual approval gate between "validated in staging" and "shipped to production." A `workflow_dispatch` "break-glass" path exists on `release-production.yml` to skip straight to production for a true emergency (see `docs/deployment.md`'s "Hotfix flow"), bypassing staging validation.
- **GHCR** stores the built image at the same `ghcr.io/novaej/comprobify` repository, tagged with the deploying commit SHA — one registry, shared across environments, differentiated only by which tag each droplet pulls.
- **Docker Compose** stack is identical in shape to staging's: `caddy`, `api`, `worker`, `redis` — same image, same `command`s, same resource limits. See `docs/deployment-reference-staging.md`'s "Docker Compose stack" section for the full service table; nothing about it is environment-specific except the rendered `.env` values and `PUBLIC_DOMAIN`.
- **Caddy** terminates TLS for `api.comprobify.com` (not `api-staging`), obtaining/renewing its own independent Let's Encrypt certificate.
- **Redis** — same self-hosted setup as staging (`redis:7-alpine`, 32MB cap, no persistence), its own separate instance on the production droplet — not shared with staging's.
- **DigitalOcean Managed Postgres** — production gets its **own dedicated cluster**, not staging's. Per `docs/deployment.md`'s "Production status" section, this cluster may in turn be shared with `comprobify-web`'s own production database if/when that's provisioned (mirroring how staging's cluster is already shared with `comprobify-web`'s staging database) — but it is never the same cluster as staging's. Same `public`/`sandbox` two-schema layout, same non-superuser app-role requirement for RLS. **Not yet provisioned.**
- **Cloudflare Pages** (`comprobify-docs`) is a single shared resource, not per-environment — nothing here changes for production.
- Same **five** scheduled admin jobs as staging (notifications, subscriptions, quota, queue reconciliation, payphone reconciliation), templated by the same `cloud-init.yaml.tftpl` — production's rendering uses `cpfydeploy4c7a` in place of staging's `cpfydeploy9x`, nothing else different. See the schedule table below.
- **CloudAMQP** — staging's `shared-broker` instance is on CloudAMQP's free tier, which provisions exactly **one vhost per instance with no multi-environment isolation**. Given every other credential in this system (SSH keys, Cloudflare tokens, DB creds, `ENCRYPTION_KEY`, `ADMIN_SECRET`, Payphone credentials) is deliberately kept separate per environment, production should get its **own CloudAMQP instance/vhost**, not reuse staging's. `docs/production-readiness-checklist.md` item 15 ("Generate unique production secrets: ... RabbitMQ vhost/creds") already tracks generating a distinct value, but doesn't spell out whether that means a new vhost on the same free-tier instance (impossible — one vhost per instance) or a genuinely separate CloudAMQP instance (likely a paid plan) — worth resolving explicitly before `RABBITMQ_URL` is set on the `production` GitHub Environment.
- The **worker container** — identical role to staging's: the only process that calls SRI directly, consuming all three queues (`sri.send`, `sri.authorize`, `app.effects`) on its own broker connection.
- **Mailgun** — same sending domain (`mg.comprobify.com`) as staging; not a per-environment resource. What differs is the registered webhook URL (`https://api.comprobify.com/v1/mailgun/webhook` instead of the `-staging` one — see below) and removing whatever sandbox-recipient restriction currently limits staging's sends (`docs/production-readiness-checklist.md` item 25).
- **Sentry** — same Sentry **project** as staging (`SENTRY_DSN` is the same value, set independently as its own `production` Environment secret), distinguished only by the `environment` tag (`production` vs `staging`, derived from `APP_ENV`) — see `docs/deployment.md`'s env var table.
- **Cloudflare** provides DNS and reverse-proxy/CDN for `api.comprobify.com`, pointed at the production droplet's reserved IP by Terraform's `cloudflare_record` resource (same mechanism as staging, separate record).

---

## Components and Platforms

| Component | Platform | Service / Project name |
|---|---|---|
| Compute (API + worker + proxy + Redis) | DigitalOcean Droplet | `comprobify-production` — `s-1vcpu-1gb`, region `nyc1`, Ubuntu 24.04 (same tier as staging's current size — revisit once real production traffic volume is known) |
| Infrastructure-as-code | Terraform | `terraform/environments/production`, state in the same DO Spaces bucket as staging (`comprobify-terraform-state`), key prefix `production/` |
| Container registry | GHCR | `ghcr.io/novaej/comprobify` — shared with staging, differentiated by image tag |
| Database | DigitalOcean Managed Database | **Not yet provisioned** — own dedicated cluster (not staging's), `public` + `sandbox` schemas, non-superuser app role required for RLS |
| Message broker | CloudAMQP | **Not yet provisioned** — should be its own instance/vhost, not staging's `shared-broker`; tracked at a high level in checklist item 15, but "new instance vs. new vhost on the same instance" isn't resolved yet (see Architecture above) |
| Docs site | Cloudflare Pages | `comprobify-docs` — shared with staging, not environment-specific |
| Scheduled jobs | `cron.d` on the droplet | `/etc/cron.d/comprobify-jobs`, written by cloud-init — same five jobs as staging, see schedule table below |
| Email | Mailgun | Domain: `mg.comprobify.com` — shared with staging; separate webhook registration |
| Error monitoring | Sentry | Same project as staging — `environment=production` tag |
| DNS / proxy | Cloudflare | Domain: `comprobify.com` — `api.comprobify.com` → droplet's reserved IP (A record, proxied, Terraform-managed) |
| App CI/CD | GitHub Actions | `comprobify` repo — `release-production.yml`, `deploy-production.yml` (both currently disabled, `if: false`) |
| Infra CI/CD | GitHub Actions | `comprobify` repo — `terraform.yml`'s `plan-production`/`apply-production` job pair (no on/off toggle, unlike staging's) |
| DO Project | DigitalOcean (dashboard) | `Comprobify Production` — **not yet created**; looked up by name in Terraform, never created by it (`data "digitalocean_project"`) |

---

## DigitalOcean — droplet (`comprobify-production`)

Provisioned by Terraform (`terraform/environments/production`, using the same shared `terraform/modules/droplet` module as staging). Baseline configuration, from `terraform/environments/production/terraform.tfvars`:

| Setting | Value |
|---|---|
| Droplet name | `comprobify-production` |
| Region | `nyc1` — same datacenter as staging, `comprobify-web`'s droplets, and the shared Spaces state bucket's parent region (the bucket itself lives in `nyc3` — see "Terraform state backend" below) |
| Size | `s-1vcpu-1gb`, 10GB disk — same tier as staging today; `resize_disk = false` keeps a future `droplet_size` change from also growing disk (see `docs/terraform-digitalocean-setup.md`'s "Resize" section) |
| Base image | `ubuntu-24-04-x64` (plain distribution image, not a Marketplace image) |
| Deploy user | `cpfydeploy4c7a` (unprivileged — docker group only, no sudo, no root SSH login) — distinct from staging's `cpfydeploy9x`, same reasoning as every other per-environment credential |
| Firewall | Same rule shape as staging: 80/443 restricted to Cloudflare's published IPv4 ranges; 22 open to `0.0.0.0/0`, defense layered at the identity level (see `docs/terraform-digitalocean-setup.md`'s "SSH access model") |
| Provisioning | cloud-init on first boot only — same `cloud-init.yaml.tftpl`, templated per-environment via `${deploy_username}` |
| DigitalOcean Project | `Comprobify Production` — **not yet created** in the DO dashboard; `terraform apply` will fail the project-lookup step until it exists (see "DO Projects" in `docs/terraform-digitalocean-setup.md`) |

### Terraform state backend

| Setting | Value |
|---|---|
| Backend | S3-compatible, DigitalOcean Spaces — same bucket as staging |
| Endpoint | `https://nyc3.digitaloceanspaces.com` |
| Bucket | `comprobify-terraform-state` (shared with staging; isolation comes from the state **key**, not a separate bucket) |
| State key | `production/comprobify/terraform.tfstate` |

---

## Docker Compose stack (on the droplet)

Identical shape to staging — same `deploy/docker-compose.yml` and `deploy/caddy/Caddyfile`, pushed and started the same way. See `docs/deployment-reference-staging.md`'s "Docker Compose stack" section for the full service table (`caddy`/`api`/`worker`/`redis`); nothing in the compose file itself is environment-specific.

Caddy's site address resolves via `{$PUBLIC_DOMAIN}` to production's actual value:

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

---

## GitHub — Environments and Secrets

Same four scopes as staging (Environment secrets/variables, `-infra` Environment, repository secrets, repository variables), with production's own `production` and `production-infra` Environments. **Every secret/variable name below is identical to staging's** — GitHub scopes secrets per-Environment, so the same name holds a different value depending on which Environment a job declares. **None of these have real values set yet.**

### GitHub Environment: `production` — Secrets

Same secret list as staging's `staging` Environment (see `docs/deployment-reference-staging.md`) — `DROPLET_IP`, `INFRA_SSH_PRIVATE_KEY`, `ENCRYPTION_KEY`, `ADMIN_SECRET`, `INTERNAL_SERVICE_SECRET`, `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`, `DB_SSL_CA`, `MAILGUN_API_KEY`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `SENTRY_DSN`, `BETTERSTACK_SOURCE_TOKEN`, `RABBITMQ_URL`, `PAYPHONE_TOKEN`, `PAYPHONE_STORE_ID`. Values that **must not be reused from staging**, per `docs/deployment.md`'s "Production status" section and `docs/production-readiness-checklist.md`:

- `ENCRYPTION_KEY`, `ADMIN_SECRET`, DB credentials, `RABBITMQ_URL` — generate fresh, independent values (checklist item 15).
- `DB_SSL_CA` — production's own cluster signs with its own private CA once provisioned; staging's CA cert will not validate against it.
- `PAYPHONE_TOKEN` / `PAYPHONE_STORE_ID` — a Payphone application is bound to its registered domain, so production needs its **own** application (KYC against the registered legal entity — currently blocked, see `docs/production-readiness-checklist.md`'s "Blocked on legal entity registration"). Until then, leave both unset: card endpoints return `503 PAYMENT_GATEWAY_NOT_CONFIGURED`, SPI transfer is unaffected.
- `SENTRY_DSN` — same **value** as staging is fine (same Sentry project), just set as its own independent secret on the `production` Environment.

### GitHub Environment: `production` — Variables

Same variable list as staging's — `APP_ENV` (**must be `production`**; the code's own default is `staging`, so a missing value here would silently run as staging with no error — see `docs/terraform-digitalocean-setup.md`'s env var table), `APP_BASE_URL`, `PUBLIC_DOMAIN` (`api.comprobify.com`, bare hostname), `DB_SSL`, `EMAIL_FROM`, `EMAIL_FROM_DOCUMENTS`, `EMAIL_PROVIDER`, `MAILGUN_DOMAIN`, `BANK_TRANSFER_*`, `ADMIN_NOTIFICATION_EMAIL`, `OPERATOR_*`, `AGREEMENTS_ENABLED`, `BETTERSTACK_INGESTING_HOST`. Notable production-specific values:

- `OPERATOR_NAME`/`OPERATOR_RUC`/`OPERATOR_EMAIL`/`OPERATOR_ADDRESS` — real values blocked on legal entity registration (checklist item 37); the operator issues real SRI-authorized invoices for subscriptions once these are set.
- `AGREEMENTS_ENABLED` — undecided (checklist item 28): leaving unset keeps legal documents enabled (requires TERMS/PRIVACY/DPA published or promotion 403s); setting to exactly `false` launches without them.

Not set at all (same code-level-default rows as staging): `PORT`, `DOCS_BASE_URL`, `VERIFICATION_TOKEN_TTL_HOURS`, `SRI_TEST_BASE_URL`, `SRI_PROD_BASE_URL`, `RATE_LIMIT_WINDOW_MS`, `RABBITMQ_SRI_EXCHANGE`, `QUEUE_RECONCILE_*`, `PENDING_EFFECTS_MAX_ATTEMPTS`, `IVA_RATE`, `SRI_MOCK_MODE` (this one matters more here than on staging — it's structurally inert once `APP_ENV=production`, but should never be intentionally set on production regardless). `REDIS_URL` is hardcoded into `deploy-production.yml`'s heredoc as `redis://redis:6379`, identical to staging's.

### GitHub Environment: `production-infra` — Secrets

Read by `terraform.yml`'s `plan-production`/`apply-production` jobs only.

| Secret | Value |
|---|---|
| `DO_TOKEN` | The `comprobify-terraform-production` token (see `docs/terraform-digitalocean-setup.md`'s Prerequisites) — never staging's |
| `CLOUDFLARE_TOKEN` | The `comprobify-terraform-production` Cloudflare token — never staging's |

**Set up this Environment's required-reviewer rule before adding real credentials to it, not after** — same ordering `staging-infra` already follows (checklist item 17), so no window exists where production infra secrets sit ungated.

### Repository secrets/variables (not environment-scoped)

Shared with staging as-is — `RELEASE_PUSH_TOKEN`, `DOCS_CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID`, `TERRAFORM_SPACES_ACCESS_KEY_ID`/`SECRET_ACCESS_KEY` (one Spaces key pair for both environments' state, different key prefixes). **No `STAGING_INFRA_ENABLED`-equivalent repository variable exists or is needed for production** — `plan-production`/`apply-production` carry no such gate (see Architecture above).

---

## Scheduled jobs (`cron.d` on the droplet)

Same five jobs as staging, same schedule, templated identically — only the deploy user differs:

| Job | Schedule | Command |
|---|---|---|
| Notifications | `*/5 * * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/notifications` |
| Subscriptions | `0 6 * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/subscriptions` |
| Quota | `10 6 * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/quota` |
| Queue Reconciliation | `*/5 * * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/queue-reconciliation` |
| Payphone Reconciliation | `*/5 * * * *` | `docker compose exec -T api node scripts/run-admin-job.js /v1/admin/jobs/payphone-reconciliation` |

Runs as `cpfydeploy4c7a` (not root). Same logging (`/opt/comprobify/logs/cron-<name>.log`, weekly rotation, 4 weeks kept) and monitoring approach as staging — see `docs/deployment-reference-staging.md`'s "Scheduled jobs" section for the full explanation (`docker compose exec` instead of installing Node, plain-file logging instead of syslog, harmless no-op before first deploy). **Do verify all five are present after the first production deploy** — see `docs/production-readiness-checklist.md`'s note on this.

---

## Background worker (worker container)

Identical role and configuration to staging's — see `docs/deployment-reference-staging.md`'s "Background worker" section. Nothing about it is environment-specific beyond the `.env` it reads.

---

## DigitalOcean Managed Postgres — Database setup

**Not yet provisioned.** Once the dedicated production cluster exists, the setup steps are identical to staging's (see `docs/deployment-reference-staging.md`'s "DigitalOcean Managed Postgres — Database setup" section for the exact SQL) — same non-superuser `comprobify_app` role requirement (RLS is bypassed for superusers), same two-step grant (`public` immediately, `sandbox` after the first deploy runs migration 033). If this cluster ends up shared with `comprobify-web`'s own production database (see Architecture above), confirm with whoever owns that project's schema/role plan before changing grants — same caution staging's shared cluster already requires.

---

## CloudAMQP — RabbitMQ setup

**Not yet provisioned** — see Architecture above for why this shouldn't simply reuse staging's `shared-broker` instance (its free tier has no multi-environment isolation). Once provisioned, the connection shape is identical to staging's: both `api` (publisher) and `worker` (consumer) connect via the same `RABBITMQ_URL`, three queues (`sri.send`, `sri.authorize`, `app.effects`).

---

## Mailgun — Webhook registration

Same Mailgun domain as staging (`mg.comprobify.com`), separate webhook registration for production's own event types (`delivered`, `failed` permanent/temporary, `complained`):

```
POST https://api.comprobify.com/v1/mailgun/webhook
```

Also remove whatever sandbox-recipient restriction currently limits staging's sends (`docs/production-readiness-checklist.md` item 25) — production needs to be able to email real tenant addresses.

---

## DNS (Cloudflare)

Managed by Terraform's `cloudflare_record` resource, part of the same `apply` that creates the production droplet.

| Record | Type | Name | Target | Proxy |
|---|---|---|---|---|
| API | A | `api` | Production droplet's reserved IPv4 (`terraform output reserved_ip`) | On (proxied, ttl = 1) |

(Docs CNAME is shared with staging — see `docs/deployment-reference-staging.md`, not repeated per environment.)

---

## Cloudflare configuration

The Email Obfuscation Configuration Rule already covers `api.comprobify.com` alongside `api-staging.comprobify.com` in its expression (see `docs/deployment-reference-staging.md`'s "Cloudflare configuration" section) — no additional Cloudflare setup needed for production specifically once the rest of this checklist is done. Full rationale in `docs/deployment.md`'s "Cloudflare configuration" section and CLAUDE.md Common Mistake #33.

---

## System dependencies

Identical to staging — `xmllint` bundled in the Docker image, RabbitMQ and Postgres are external infrastructure, Docker/fail2ban/unattended-upgrades/cron installed by cloud-init. Nothing here differs per environment.

---

## Deployment flow

1. A version tag (`vX.Y.Z`) is pushed and already validated in staging via the normal `release-staging.yml` → `deploy-staging.yml` pipeline.
2. A GitHub Release is **published** from that tag — this is the explicit human approval step; `release-production.yml` triggers on `release: types: [published]`, not on the tag push itself.
3. `release-production.yml` fast-forwards the `production` branch to the released tag and pushes it.
4. The push to `production` triggers `deploy-production.yml`, which builds the Docker image and pushes it to `ghcr.io/novaej/comprobify:<commit-sha>` (same registry as staging).
5. `deploy-production.yml` copies `deploy/docker-compose.yml` and `deploy/caddy/Caddyfile` to `/opt/comprobify` over SCP, then SSHes in (as `cpfydeploy4c7a`) to write `/opt/comprobify/.env` from the `production` Environment's Secrets/Variables and run `docker compose pull && docker compose up -d`.
6. Migrations run automatically inside the `api` container at startup, same as staging — no separate migration step.
7. Scheduled jobs and worker deploy as part of the same Compose stack, same as staging.

**Break-glass path:** `release-production.yml` also accepts a manual `workflow_dispatch` to promote a tag straight to production without a published Release — documented as the emergency-only hotfix path in `docs/deployment.md`, bypassing staging validation.

Both workflows are currently gated `if: false` with their real triggers commented out — see the top of this document and `docs/production-readiness-checklist.md` items 19–20 for what enabling them requires.

---

## Post-deployment checks

Once live, same shape as staging's (see `docs/deployment-reference-staging.md`'s "Post-deployment checks" section for the full list — migrations applied, all five cron jobs running, worker consuming all three queues, agreement HTML unobfuscated, a test document reaching `PENDING_SEND`/`RECEIVED`) against production's own domain and admin secret:

```
curl -s https://api.comprobify.com/health
# → {"status":"ok","uptime":...,"version":"0.16.5"}

curl -s https://api.comprobify.com/v1/admin/tenants \
  -H "Authorization: Bearer $ADMIN_SECRET"
# → {"ok":true,"tenants":[...]}
```

Two checks specific to a **first** production deploy, beyond what staging's list covers: onboard the first real tenant and promote to production to verify one real invoice against SRI's actual production endpoint (not the test endpoint staging always uses), and — once Payphone's production application exists — verify one real card payment end-to-end (`docs/production-readiness-checklist.md` items 38 and 41).

---

See `docs/production-readiness-checklist.md` for the authoritative, up-to-date list of what's done versus pending toward enabling this environment for real.
