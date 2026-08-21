# Production Readiness Checklist

Tracks what's left to take comprobify from staging-only to a live `APP_ENV=production` deployment. Not a replacement for `docs/deployment.md`'s "Production status" section or `docs/terraform-digitalocean-setup.md`'s "First deploy checklist" — this is the top-level tracker; those two have the actual step-by-step mechanics.

Items are grouped by whether they're currently blocked, and on what.

---

## Unblocked

- [x] Create the `production` git branch (fast-forward-only, mirrors `staging`)
- [x] Write `terraform/environments/production` (droplet + DO Managed Postgres, mirroring staging's setup)
- [x] Add the `plan-production`/`apply-production` job pair to `terraform.yml`
- [x] Fix `deploy/caddy/Caddyfile` for the production domain (was hardcoded to `api-staging.comprobify.com`; now `{$PUBLIC_DOMAIN}`, Caddy's own env-var substitution, fed per-environment by each deploy workflow)
- [ ] Generate unique production secrets: `ENCRYPTION_KEY`, `ADMIN_SECRET`, DB creds, RabbitMQ vhost/creds
- [ ] Set up the `production` GitHub Environment's app secrets/variables (full set mirroring `staging`'s)
- [ ] Set up the `production-infra` GitHub Environment (`DO_TOKEN`/`CLOUDFLARE_TOKEN`) — required-reviewer rule added *before* the secrets, never after
- [ ] Create the "Comprobify Production" DigitalOcean Project (looked up by name in Terraform, never created by it)
- [ ] Enable `release-production.yml` (uncomment trigger, remove `if: false`)
- [ ] Enable `deploy-production.yml` (uncomment trigger, remove `if: false`)
- [ ] Add branch protection to `production` (restrict pushes to automation, no force pushes)
- [ ] `terraform apply` — provision the droplet, DO Managed Postgres, Cloudflare DNS record
- [ ] First-deploy DB steps: create the non-superuser app role, grant `public` + `sandbox` schema privileges
- [ ] Push the first production tag/release, verify the pipeline (health check, admin auth, `xmllint`)
- [ ] Register the production Mailgun webhook, remove the sandbox recipient restriction
- [ ] Extend the Cloudflare Email Obfuscation rule to `api.comprobify.com`
- [ ] Publish all 12 notification email templates (6 types × es/en) via the admin API
- [ ] Run through the 18-item production security checklist in `docs/deployment.md`
- [x] Write and test an `ENCRYPTION_KEY` rotation script — `scripts/rotate-encryption-key.js`, `--dry-run` support, unit-tested (`tests/unit/scripts/rotate-encryption-key.test.js`), and both dry-run and real commit paths verified against a real local database

Not a separate action: the 4 scheduled cron jobs. `cloud-init.yaml.tftpl` already templates them per environment via `${deploy_username}`, so they land automatically the moment `terraform apply` provisions the production droplet.

## Blocked on legal entity registration

- [ ] Set real `OPERATOR_*` env vars, publish TERMS/PRIVACY/DPA agreements to production
- [ ] Onboard the first real tenant, promote to production, verify one real invoice against SRI's actual production endpoint

*(Corrected wording in the existing DPA/Privacy Policy source — `DigitalOcean App Platform` → `DigitalOcean`, matching comprobify-web's actual hosting — is unrelated to this blocker and already unblocked; see `docs/legal-reviews/2026-08-17-web-hosting-subprocessor-review.md`.)*

---

## Staging lifecycle once production is live

Decided: only production runs continuously. Staging's droplet and its Managed Postgres cluster (not Terraform-managed, torn down by hand) get destroyed between uses instead of left running idle — the Terraform code for staging stays in the repo, just not applied against anything most of the time.

- [ ] Set the `STAGING_INFRA_ENABLED` repository variable (`terraform.yml` gates `plan-staging`/`apply-staging` on it — see `docs/terraform-digitalocean-setup.md`'s "Toggling staging infra on/off")

Cycle going forward: flip `STAGING_INFRA_ENABLED` to `true` → `terraform apply` staging + manually recreate the DB cluster and anything else destroyed → land and validate the infra change there → flip back to `false` → destroy the droplet/cluster by hand again. `production-infra`'s required-reviewer gate (once set up, matching `staging-infra`'s existing one) is what actually sequences "validate in staging, then apply to production" — approve staging's run, check it, then separately approve production's.
