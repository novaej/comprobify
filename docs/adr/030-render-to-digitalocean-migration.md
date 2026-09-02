# ADR-030: Staging Infrastructure Migration from Render to Terraform-Managed DigitalOcean

## Status
Accepted — **written retroactively** (2026-09-01) to preserve the reasoning behind a decision already made and implemented in PR #120 (merged 2026-07-23). Several other ADRs (015, 016, 019, 022, 026, 028) already reference "the move off Render" in passing; this is the decision record that was missing.

## Date
2026-07-23 (the decision this documents; written up on 2026-09-01)

## Context

Staging's hosting platform had already moved twice before this decision: an early, unmanaged DigitalOcean setup, then Azure App Service (#4), then Render (#5) — the platform this ADR moves away from. None of those earlier moves have their own ADR; this one exists because the Render→DigitalOcean move is the one that introduced durable infrastructure-as-code (Terraform) and is still referenced by name throughout the current docs and several ADRs.

On Render, the application was split across three separately billed service *types*, six billed *instances* in total: a web service (`api`), a Background Worker service (`workers/sri-worker.js`), and, once scheduled jobs existed, four separate Render Cron Job services — one per admin job (notifications, subscriptions, quota, queue-reconciliation). Each instance was its own line item, and each was managed by hand through Render's dashboard or a Blueprint file, not through a reviewable, diffable infrastructure definition.

That lack of infra-as-code was a concrete, already-felt cost, not a hypothetical one: [ADR-022](022-effects-outbox.md)'s "One worker process, not two" section notes that renaming `workers/sri-worker.js` to `workers/worker.js` also meant renaming the Render service (`comprobify-staging-sri-worker` → `comprobify-staging-worker`), and that "Render treats a changed Blueprint `name:` as a new service rather than an in-place rename," requiring a manual re-adoption step in the dashboard after every merge that touched it — "the same recovery dance `NEXT_STEPS.md` already documents for the original 3 cron jobs." A platform where renaming a file requires a manual dashboard intervention is expensive in a way that compounds every time the codebase reorganizes.

Cost was the other driver: six independently billed Render line items (1 web service + 1 worker + 4 cron jobs) for what is, underneath, one small application and a handful of scheduled admin calls.

## Decision

**Provision one Terraform-managed DigitalOcean droplet per environment, running the whole stack as a single Docker Compose unit, with infrastructure changes and application deploys kept as two pipelines that never trigger each other.**

### Infrastructure as two independent pipelines

1. **Terraform** (`terraform/modules/droplet`, state in a DigitalOcean Spaces bucket, not a local file or the repo) — rare, reviewed changes: create/resize/destroy a droplet, change a firewall rule, update a DNS record. `.github/workflows/terraform.yml` runs `plan` on every push to `terraform/**`, gated to `apply` behind a separate `staging-infra` GitHub Environment (deliberately not the same `staging` Environment the application deploy uses, so a required-reviewer rule on one doesn't also gate the other).
2. **Application CD** (GitHub Actions, unchanged in spirit from the Render era) — every push to `staging`/`production` builds a Docker image, pushes it to GHCR, and deploys it to the already-running droplet over SSH. It can never accidentally recreate a droplet; a Terraform apply can never accidentally ship new application code.

### One droplet, one Compose stack, not six services

`deploy/docker-compose.yml` runs `caddy` (the only container with ports exposed to the internet, terminating TLS via Let's Encrypt), `api`, `worker` (same image as `api`, different `command` — `workers/worker.js`, already renamed by ADR-022 independent of this migration), and `redis` (self-hosted, backing the shared rate-limit store — see [ADR-026](026-redis-shared-counter-store.md)). This consolidates what were six separate Render-billed instances (the web service, the worker, and four cron jobs) into one compute cost.

### Scheduled jobs: `cron.d` on the droplet, not a fourth service type

The 4 admin jobs move from 4 Render Cron Job services to a single `cron.d` file, written to the droplet by cloud-init on first boot, calling `scripts/run-admin-job.js` via `docker compose exec` inside the running `api` container — no separate host Node install, since the script has zero npm dependencies and `ADMIN_SECRET` is already in the container's own `.env`. This is the same reasoning that justified Render Cron Job over a third-party scheduler like cron-job.org in the first place (see [ADR-015](015-notifications.md)'s §4): trigger scheduled admin work from infrastructure you already control. What changed here is cost, not design — a `cron.d` entry on a droplet already being paid for costs nothing extra, not even the fractions-of-a-cent-per-run Render Cron Job billed.

### SSH access model — iterated twice before landing

Getting CI access to the droplet right took three attempts, in order:

1. **An IP-allowlist firewall rule** (`admin_ip_cidr`). Rejected in practice, not in theory — it produced a false-positive failure that looked like CGNAT, and it fundamentally cannot work for CI in the first place: GitHub-hosted runners have no fixed IP to allowlist.
2. **A just-in-time firewall rule**, opened by the deploy workflow at the start of a run and closed at the end (`if: always()`, so a failed deploy still cleans up). Technically workable but operationally fragile — it needed a separate, narrowly-scoped DO token and a `firewall_id` Terraform output kept in sync with the workflow, and failed twice before it ever completed a deploy successfully.
3. **SSH left open to `0.0.0.0/0`, with defense moved to the identity/privilege layer instead** (shipped): no root login (`PermitRootLogin no`), a single unprivileged deploy user with no `sudo` at all, `AllowUsers` restricting SSH to just that account, `MaxAuthTries`/`LoginGraceTime` limiting scanning-noise cost, and `fail2ban` banning repeated failed attempts at the firewall level. This is the same "don't rely on network-level restriction where identity-level restriction is more robust" judgment call already familiar from RLS's own null-bypass design (ADR-012) — trading a theoretically tighter but operationally fragile network control for a simpler one that actually holds up under CI's constraints.

### What was deliberately not touched in the same change

`docs/agreements/privacy-policy.md`/`data-processing-agreement.md` still named Render as the infrastructure subprocessor after this migration — left untouched on purpose, since fixing them means publishing a new agreement template version that existing tenants must re-accept (see [ADR-018](018-legal-document-acceptance.md)), not a plain markdown edit. This was corrected properly, as its own deliberate change, later (#195). `docs/infrastructure-costs.md` is explicitly scoped to production only, and production hadn't moved off standby at the time, so it was left as-is pending an actual production infrastructure decision.

## Consequences

### Positive
- Six Render-billed line items (web service, worker, 4 cron jobs) collapse into one droplet's compute cost, plus a DO Spaces line for Terraform state that's effectively free (shared with production's own state).
- Infrastructure changes are now reviewable diffs (`terraform plan` output on every PR touching `terraform/**`) instead of manual dashboard/Blueprint edits — the exact gap that made ADR-022's worker rename painful no longer exists.
- The migration surfaced and fixed three real, previously-latent bugs as a direct byproduct, not a bolt-on: `src/server.js`'s `trust proxy` had been left at `1` (correct for Render's single-hop load balancer) while the new topology has two hops (Cloudflare, then Caddy) in front of the app — `adminLimiter`/`registrationLimiter` in `rate-limit.js` key purely off `req.ip` with no fallback, so every client was silently being pooled into one shared rate-limit bucket instead of limited per-client; now set to `2`. Separately, cloud-init's `systemctl restart sshd` had the wrong unit name for Ubuntu (it's `ssh`) and had likely been silently failing since the very first cloud-init version, never caught because the SSH key still worked regardless of whether the restart succeeded. And GHCR authentication only covered the CI runner (`docker/login-action`) — the droplet's own Docker daemon, pulling that same private image via `docker compose pull` over SSH, was never authenticated and failed with "unauthorized" until an explicit login step was added on the droplet itself.
- The infra/application pipeline split means an infra change can never accidentally ship code, and a code deploy can never accidentally touch the droplet's own definition — a stronger blast-radius guarantee than Render's single deploy-hook model offered.

### Negative
- OS-level security patching is now this project's own responsibility rather than a PaaS's, mitigated by `unattended-upgrades` but still a real operational surface Render abstracted away entirely.
- SSH is open to the whole internet on port 22 — a choice that reads as alarming in isolation and depends entirely on the identity-layer defenses (no root, unprivileged deploy user, `fail2ban`) actually being correctly configured and kept that way; a network-level restriction would fail safe in a way this doesn't if one of those layers is ever weakened by mistake.
- No managed autoscaling, zero-downtime rolling deploys, or health-check-based auto-restart of the kind a PaaS provides by default — `docker compose pull && up -d` is a manual restart of the whole stack on every deploy, and scaling today means resizing one droplet, not adding replicas behind a load balancer.
- This migration covered staging only; production stayed on standby throughout, deliberately sequenced *after* staging validated the DigitalOcean/Terraform setup (`docs/deployment.md`'s "Production status" section — the production pipeline exists in the repo with its triggers disabled, since the production droplet, branch, database, domain, and secrets don't exist yet). A `terraform/environments/production` definition and a `STAGING_INFRA_ENABLED` toggle (so staging's own droplet/database can eventually be torn down between uses once production is the one running continuously) exist on a separate, not-yet-merged branch as of this writing — production still isn't live, and the broader production launch also has its own outstanding legal/business checklist items unrelated to Terraform. Staging validating the pattern doesn't by itself prove the production sizing/cost numbers in `docs/infrastructure-costs.md`, which are explicitly flagged there as TBD.

### Mitigation
- `unattended-upgrades` runs automatically on a schedule, so the self-managed-patching negative above is reduced to "unattended, but not absent."
- The SSH hardening choice is documented explicitly (`docs/terraform-digitalocean-setup.md`'s "SSH access model" section) specifically so a future reader doesn't mistake the open port for an oversight and "fix" it back into the JIT-firewall fragility this ADR already tried and rejected.
- Terraform's plan-then-apply gate, and the fact that `cloud-init.yaml.tftpl`/SSH-key edits are the one case that forces a destroy-and-recreate rather than an in-place update, are both documented in `docs/terraform-digitalocean-setup.md` so an operator doesn't trigger an unplanned droplet replacement by editing the wrong file casually.

### Alternatives Considered
- **Stay on Render, accept the six-line-item cost and dashboard-only management.** Rejected — the ADR-022 worker-rename pain was already a concrete, felt cost of no infra-as-code, and the cron-job cost alone (4 separate billed services for what became one `cron.d` file) had no offsetting benefit once a droplet was being paid for anyway.
- **IP-allowlist SSH restriction.** Tried first, reverted — see "SSH access model" above; doesn't work for CI runners with no fixed IP, and produced at least one false-positive lockout for personal access too.
- **Just-in-time, per-deploy firewall rule.** Tried second, reverted — technically sound but operationally fragile in practice (a second DO token, a `firewall_id` output to keep synced, two failed deploys before it worked once).
- **A different managed container platform** (e.g. Fly.io, Railway) instead of a bare droplet: not evaluated in depth. Render's specific pain points (per-service-type billing, no infra-as-code) were the direct trigger, and DigitalOcean plus Terraform directly addressed both at low cost and with tooling (Terraform) the project could reuse for other infrastructure later — a full platform bake-off wasn't performed, and this is a reasonable follow-up if DigitalOcean itself ever becomes the bottleneck.

## Addendum: what happened after initial acceptance

Day-2 hardening followed in several smaller, independent PRs rather than amendments to this one: passing the SSH public key's content to Terraform instead of a local file path (#121); tightening the queue-reconciliation cron cadence and adding a stable Reserved IP to the staging droplet (#126); making droplet resizing reversible by leaving `resize_disk = false` (#130); resizing the staging droplet to `s-1vcpu-1gb` once the smallest tier proved insufficient (#140); no longer managing the DigitalOcean Project resource's own lifecycle via Terraform (#142); moving the staging droplet to the `nyc1` region (#144); and, most recently, gating the staging Terraform workflow's destroy action through a plan step before apply rather than one combined job (#201, #202), now on `main`. Separately, a `terraform/environments/production` definition and a `STAGING_INFRA_ENABLED` cost-saving toggle for staging's own infrastructure exist on an as-yet-unmerged branch (`feat/production-terraform-environment`) — production infrastructure is written but not yet live.
