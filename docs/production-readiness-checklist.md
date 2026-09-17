# Production Readiness Checklist

Tracks what's left to take comprobify from staging-only to a live `APP_ENV=production` deployment. Not a replacement for `docs/deployment.md`'s "Production status" section or `docs/terraform-digitalocean-setup.md`'s "First deploy checklist" — this is the top-level tracker; those two have the actual step-by-step mechanics.

Items are grouped by whether they're currently blocked, and on what.

---

## Unblocked

- [x] Create the `production` git branch (fast-forward-only, mirrors `staging`)
- [x] Write `terraform/environments/production` (droplet + DO Managed Postgres, mirroring staging's setup)
- [x] Add the `plan-production`/`apply-production` job pair to `terraform.yml`
- [x] Fix `deploy/caddy/Caddyfile` for the production domain (was hardcoded to `api-staging.comprobify.com`; now `{$PUBLIC_DOMAIN}`, Caddy's own env-var substitution, fed per-environment by each deploy workflow)
- [x] Generate unique production secrets: `ENCRYPTION_KEY`, `ADMIN_SECRET`, DB creds, RabbitMQ vhost/creds, `INTERNAL_SERVICE_SECRET`
- [x] Set up the `production` GitHub Environment's app secrets/variables (full set mirroring `staging`'s)
- [x] **Coordinate `INTERNAL_SERVICE_SECRET` with comprobify-web's production deployment.** As of #208/ADR-035 this is required at startup — the API won't boot without it set to *something* — but a value that doesn't match comprobify-web's own production config boots fine and silently 403s every `POST /v1/register`/`/recover`/`/resend-verification` call with `INTERNAL_SERVICE_ONLY`. Unlike the other secrets above, this one can't be generated unilaterally on this side alone; both deployments must agree on the exact same value before either side goes live. See `docs/deployment-reference-production.md`'s GitHub Secrets section. **Coordinated** — the same value is set in both comprobify's and comprobify-web's production GitHub Environments.
- [x] Set up the `production-infra` GitHub Environment (`DO_TOKEN`/`CLOUDFLARE_TOKEN`) — required-reviewer rule added *before* the secrets, never after. **Was actually missing** (briefly reverted to unchecked 2026-09-12 after the security audit, `docs/security-audit-2026-09-12.md` #1, verified live via `gh api` that it had zero protection rules despite this checkbox already being checked once). **Fixed and re-verified 2026-09-14**: `gh api`'s attempt to add the rule hit a billing-plan error again (same unresolved gotcha as before, even on GitHub Team); the repo was made public (a separate, deliberate decision — see the audit doc) which unblocks required-reviewer rules regardless of billing plan, and the rule was added via the GitHub UI. Confirmed live: `production-infra` and `staging-infra` both show a `required_reviewers` rule with `can_admins_bypass: false`.
- [x] Create the "Comprobify Production" DigitalOcean Project (looked up by name in Terraform, never created by it)
- [x] Enable `release-production.yml` (uncomment trigger, remove `if: false`)
- [x] Enable `deploy-production.yml` (uncomment trigger, remove `if: false`)
- [x] Add branch protection to `production` (restrict pushes to automation, no force pushes)
- [x] `terraform apply` — provision the droplet + Cloudflare DNS record (Terraform-managed), and separately create the DO Managed Postgres cluster by hand (not Terraform-managed, same as staging — see `docs/deployment-reference-production.md`)
- [x] First-deploy DB step 1 — create the non-superuser app role, grant `public` schema privileges
- [x] First-deploy DB step 2 — grant `sandbox` schema privileges. **Turned out to be unnecessary**: `comprobify_app` creates `sandbox` itself the moment migration 033 runs (migrations always run as the app's own DB user), so it's already the schema's *owner* — verified directly (`has_usage`/`has_create` both `true`, `owner: comprobify_app`) with zero explicit grants needed. Different from `public`, which is owned by the database/cluster, not by `comprobify_app` — that one genuinely needs `doadmin` to grant it explicitly.
- [x] Push the first production tag/release, verify the pipeline (health check, admin auth, `xmllint`)
- [x] Register the production Mailgun webhook, remove the sandbox recipient restriction
- [x] Extend the Cloudflare Email Obfuscation rule to `api.comprobify.com` — already covered `api.comprobify.com` in its expression alongside staging's, confirmed via the Cloudflare dashboard; no change was actually needed
- [x] Publish all 12 notification email templates (6 types × es/en) via the admin API — published fresh at `version: "v1"` against production's own database (never published there before, so no re-publish concern applied); content read straight from `docs/email-templates/*.txt`, already reflecting the post-#197 `PAYMENT_VERIFIED` wording
- [x] Decide `AGREEMENTS_ENABLED` for production. **Decided: `false`, for now** — launches without Terms/Privacy/DPA rather than blocking on publishing/reviewing them first (see the legal-entity section below). Revisit once the legal documents are ready to go live; re-enabling later needs comprobify-web's re-acceptance prompt shipped first, since publishing then would 403 every existing tenant's promotion until they re-accept.
- [x] Run through the 18-item production security checklist in `docs/deployment.md` — all 18 confirmed passing, including PostgreSQL's public-port exposure (DO Trusted Sources allowlists only the production droplet's IP)
- [x] Full security audit (CI/CD, deployment, and application) — see `NEXT_STEPS.md` #5. Broader and more thorough than the 18-item checklist above; should happen before real production tenant data is flowing. **Done 2026-09-14, before real tenant data flows** (item 40 below — onboarding the first real tenant — is still unblocked-but-unchecked): full findings and resolutions in `docs/security-audit-2026-09-12.md`. Every High and Medium finding is resolved (env protection rules, DB disaster recovery + tested restore, the encryption-key rotation tool's shell-history leak, GitHub Actions SHA pinning, Docker digest pinning + Trivy scanning, `npm audit`/Dependabot/secret scanning, plus two application-layer fixes). What's left is 3 Low-priority findings (#9, #12, #13 — none secret-at-rest or exploitable, just hardening) and 3 Informational notes (#14–16) — none block onboarding a real tenant.
- [x] Write and test an `ENCRYPTION_KEY` rotation script — `scripts/rotate-encryption-key.js`, `--dry-run` support, unit-tested (`tests/unit/scripts/rotate-encryption-key.test.js`), and both dry-run and real commit paths verified against a real local database

Not a separate action: the 5 scheduled cron jobs (notifications, subscriptions, quota, queue reconciliation, payphone reconciliation). `cloud-init.yaml.tftpl` already templates them per environment via `${deploy_username}`, so they land automatically the moment `terraform apply` provisions the production droplet. **Do still verify all five are present after the first deploy** — the count is easy to leave stale, and a job that exists but was never scheduled fails silently and indefinitely.

## Blocked on legal entity registration

- [x] Set real `OPERATOR_*` env vars — `OPERATOR_RUC` set to the real value. Confirmed this is the only one actually consumed at runtime while `AGREEMENTS_ENABLED=false`: `config.operator.ruc` is read unconditionally by `base.builder.js`'s `buildAdditionalInfo()` for every invoice/credit-note XML (SRI Resolution NAC-DGERCGC26-00000027 requirement), but `OPERATOR_NAME`/`OPERATOR_EMAIL`/`OPERATOR_ADDRESS` are read only inside `agreement.service.js`'s `publish()` — the admin "publish a legal document" action, which nothing calls while agreements stay disabled. Those three can stay blank until the legal documents are actually published.
- [x] Onboard the first real tenant **via comprobify-web** — direct `POST /v1/register` is no longer possible (#208/ADR-035, registration is web-app-only), so this item is also gated on comprobify-web's own production deployment being live with a matching `INTERNAL_SERVICE_SECRET` (see the coordination item above) — promote to production, verify one real invoice against SRI's actual production endpoint. **Done** — first real tenant registered via comprobify-web, promoted to production, and a real invoice verified against SRI's production endpoint.
- [x] **Card payments in production.** A Payphone application is bound to its registered domain, so production needs its own application and its own `PAYPHONE_TOKEN`/`PAYPHONE_STORE_ID` — the staging store's credentials will not authorise a production charge. Creating it requires KYC against the registered legal entity, which is what puts this here rather than under Unblocked. Until then, leave both unset: the card endpoints return `503 PAYMENT_GATEWAY_NOT_CONFIGURED` and SPI bank transfer is unaffected, which is a supported launch state, not a broken one. **Done** — production Payphone application created with its own `PAYPHONE_TOKEN`/`PAYPHONE_STORE_ID`.
- [x] Register the production Payphone application against `comprobify-web`'s actual **production** domain, not just create it — the Cajita widget only renders on the domain registered in Payphone's console (ADR-028), so a mismatched domain looks configured (credentials set, `503` gone) but silently fails to render at checkout. **Done** — registered against comprobify-web's actual production domain.
- [x] Once credentials exist, verify one real card payment end-to-end against Payphone's live (non-sandbox) endpoint — mirrors the "verify one real invoice against SRI's actual production endpoint" item above; a Payphone sandbox pass doesn't guarantee the live credentials/domain pairing actually works. **Done** — a real card payment verified end-to-end against Payphone's live production endpoint.

### Publishing the legal documents is no longer a hard blocker

`AGREEMENTS_ENABLED=false` (added in #199) runs the product without TERMS/PRIVACY/DPA entirely: the public agreement endpoints behave as if nothing were published, and `POST /v1/tenants/promote` stops being gated on acceptance. So launching before the documents are reviewed is a supported path, and the decision belongs in the Unblocked list above.

Two things to know before choosing:

- **The documents exist and are current.** They were revised on 2026-08-30 (#199): both payment methods and per-method activation in ToS §4 — which had described an activation gate removed back in #197 — plus card-transaction disclosure and a corrected processor/controller split in the Privacy Policy. What they have *not* had is review by a lawyer. Shipping them unreviewed still gives a liability cap, acceptable-use rules and a governing-law clause; shipping without them gives none of those. That trade-off is the actual decision here, not "ready or not ready".
- **Turning them on later is not free.** Publishing a `TERMS` version makes `hasAllAccepted()` false for every existing tenant, and its only caller is `promote()` — so every sandbox→production promotion returns `403 AGREEMENT_ACCEPTANCE_REQUIRED` until each tenant re-accepts. Launch disabled if you like, but re-enabling needs comprobify-web's re-acceptance prompt shipped first.

Outstanding legal follow-ups, neither blocking: the controller/processor characterisation is worth a second opinion (`docs/legal-reviews/2026-08-30-counsel-brief-processor-characterisation.md` is written and self-contained), and it is still unconfirmed whether signed data-processing terms exist with the current subprocessors as opposed to reliance on their published standard terms — the larger exposure of the two, since Comprobify's own DPA promises tenants things that depend on those flow-downs.

*(Corrected wording in the existing DPA/Privacy Policy source — `DigitalOcean App Platform` → `DigitalOcean`, matching comprobify-web's actual hosting — is unrelated to this blocker and already unblocked; see `docs/legal-reviews/2026-08-17-web-hosting-subprocessor-review.md`.)*

---

## Staging lifecycle once production is live

Decided: only production runs continuously. Staging's droplet and its Managed Postgres cluster (not Terraform-managed, torn down by hand) get destroyed between uses instead of left running idle — the Terraform code for staging stays in the repo, just not applied against anything most of the time.

- [x] Set the `STAGING_INFRA_ENABLED` repository variable (`terraform.yml` gates `plan-staging`/`apply-staging` on it — see `docs/terraform-digitalocean-setup.md`'s "Toggling staging infra on/off") — set to `false`; staging's droplet is destroyed
- [x] Disable `deploy-staging.yml` while staging's droplet doesn't exist — otherwise every push to `main` fails its deploy step trying to SSH to a `DROPLET_IP` that no longer resolves to anything.

Cycle going forward: flip `STAGING_INFRA_ENABLED` to `true` → `terraform apply` staging + manually recreate the DB cluster and anything else destroyed → re-enable `deploy-staging.yml` (uncomment its `push` trigger, remove the `if: false` guard) → land and validate the infra change there → flip `STAGING_INFRA_ENABLED` back to `false` → disable `deploy-staging.yml` again → destroy the droplet/cluster by hand. `production-infra`'s required-reviewer gate is what actually sequences "validate in staging, then apply to production" — approve staging's run, check it, then separately approve production's.
