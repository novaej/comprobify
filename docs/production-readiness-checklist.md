# Production Readiness Checklist

Tracks what's left to take comprobify from staging-only to a live `APP_ENV=production` deployment. Not a replacement for `docs/deployment.md`'s "Production status" section or `docs/terraform-digitalocean-setup.md`'s "First deploy checklist" — this is the top-level tracker; those two have the actual step-by-step mechanics.

Items are grouped by whether they're currently blocked, and on what.

---

## Unblocked

- [x] Create the `production` git branch (fast-forward-only, mirrors `staging`)
- [x] Write `terraform/environments/production` (droplet + DO Managed Postgres, mirroring staging's setup)
- [x] Add the `plan-production`/`apply-production` job pair to `terraform.yml`
- [ ] Fix `deploy/caddy/Caddyfile` for the production domain (currently hardcoded to `api-staging.comprobify.com`)
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
- [ ] Write and test an `ENCRYPTION_KEY` rotation script (none exists yet — do this before it's ever needed for real)

Not a separate action: the 4 scheduled cron jobs. `cloud-init.yaml.tftpl` already templates them per environment via `${deploy_username}`, so they land automatically the moment `terraform apply` provisions the production droplet.

## Blocked on legal entity registration

- [ ] Set real `OPERATOR_*` env vars, publish TERMS/PRIVACY/DPA agreements to production
- [ ] Onboard the first real tenant, promote to production, verify one real invoice against SRI's actual production endpoint

*(Corrected wording in the existing DPA/Privacy Policy source — `DigitalOcean App Platform` → `DigitalOcean`, matching comprobify-web's actual hosting — is unrelated to this blocker and already unblocked; see `docs/legal-reviews/2026-08-17-web-hosting-subprocessor-review.md`.)*

---

## Open question: keeping staging running after production launches

Not yet decided — see the conversation this file came out of. Running both environments continuously means paying for two droplets (plus, per `docs/deployment.md`'s "Production status," production is planned to get its **own** Managed Postgres cluster, not share staging's), but the release pipeline (`docs/deployment.md`'s branching strategy) is built around validating every tag in staging *before* promoting it to production — permanently removing staging changes that pipeline, it doesn't just save money. Needs a deliberate decision, not a default.
