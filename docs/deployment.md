# Deployment

---

## Branching strategy

Two long-lived branches map to deployed environments. They are **automation-owned** — promoted forward by tags and GitHub Releases, never by direct or manual merges. Feature/fix branches are always cut from `main` and merged back via pull request.

```
  feature/xyz     chore/release            main                                   staging                  production
      │                 │                   │                                       │                          │
      │  PR + merge     │                   │                                       │                          │
      │────────────────────────────────────▶│                                       │                          │
      │                 │  npm version bump │                                       │                          │
      │                 │  + PR + merge     │                                       │                          │
      │                 │──────────────────▶│                                       │                          │
      │                 │                   │  git tag vX.Y.Z + push (merge commit) │                          │
      │                 │                   │── release-staging.yml (ff-merge) ────▶│── deploy-staging.yml ───▶ comprobify-staging
      │                 │                   │                                       │                          │
      │                 │                   │  publish GitHub Release from the tag  │                          │
      │                 │                   │── release-production.yml (ff-merge) ──┼─────────────────────────▶│── deploy-production.yml ──▶ comprobify-production
      │                 │                   │                                                                   │
  hotfix/xyz            │                   │                                                                   │
      │  branch off `production`, PR into the hotfix branch, bump version + PR there too,                      │
      │  tag vX.Y.Z+1 → same pipeline (or emergency workflow_dispatch to skip staging)                         │
      │  → cherry-pick the merged fix back into `main`                                                         │
      │─────────────────────────────────────────────────────────────────────────────────────────────────────▶ │
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

Every commit on `main` is a merged (often squashed) PR, so `npm version`'s built-in commit+tag step can't run directly on `main` — it would push straight to `main` with no review, and the tag would point at a commit review never saw. Bump the version through a normal PR first, then tag the result. Full rationale in the "Releasing" section of `../CLAUDE.md`.

```bash
# 1. Branch off main and bump the version (package.json + package-lock.json only, no commit/tag)
git checkout main
git pull origin main
git checkout -b chore/release
npm --no-git-tag-version version patch   # or minor / major

# 2. In CHANGELOG.md, rename "## [Unreleased]" to "## [X.Y.Z] — <today's date>"
#    and add a fresh empty "## [Unreleased]" above it

# 3. Commit, push, open a PR, merge it like any other change
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: bump version to X.Y.Z"
git push origin chore/release

# 4. AFTER the PR merges, tag the resulting merge commit on main — not your branch commit
git checkout main
git pull origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

`release-staging.yml` fast-forwards `staging` to `vX.Y.Z` and pushes it, which triggers `deploy-staging.yml` automatically. Use semantic versioning (`vMAJOR.MINOR.PATCH`) so it's obvious at a glance whether a tag is a feature release (`v1.5.0`) or a hotfix (`v1.4.1`). The tag is treated as an **immutable** "build this" snapshot — never push a follow-up commit to `main` that changes the version after a tag is created.

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

# 3. Bump the version and update CHANGELOG.md on the hotfix branch (same reasoning as "Release to
#    staging" above — the PR merge changes the commit SHA, so bump before tagging, not after)
git checkout hotfix/payment-bug
git pull origin hotfix/payment-bug
npm --no-git-tag-version version patch
# rename CHANGELOG.md's "## [Unreleased]" to "## [X.Y.Z] — <today's date>", add a fresh one above it
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: bump version to X.Y.Z"
git push origin hotfix/payment-bug

# 4. Tag the result — this feeds the same release pipeline
git tag vX.Y.Z
git push origin vX.Y.Z
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
2. Provision the `comprobify-production` Render web service + a production **Neon** Postgres project (own project, `public` + `sandbox` schemas — see `docs/infrastructure-costs.md`'s "Stack" table for the full production platform decision), with **independent** `ADMIN_SECRET` / `ENCRYPTION_KEY` / DB credentials from staging — never share these between environments
3. Add `RENDER_DEPLOY_HOOK_URL` as a secret on the `production` GitHub environment (and `STAGING_API_BASE_URL` / `ADMIN_SECRET` if mirroring the notification scheduler too)
4. In `release-production.yml`: uncomment the `release: types: [published]` trigger and remove the `if: false` guard on the `promote` job
5. In `deploy-production.yml`: uncomment the `push: branches: [production]` trigger and remove the `if: false` guard on the `deploy` job
6. Add branch protection to `production` (restrict who can push to the automation only; no force pushes) — see GitHub repository setup below
7. Add a `comprobify-cron-production` env var group (`API_BASE_URL` only — `ADMIN_SECRET` is never declared in the file, see below) and three `branch: production` cron services to `render.yaml` (mirroring the existing staging ones), then sync the Blueprint. As brand-new resources with no prior environment assignment, they will need one manual step afterward to move them into the Production environment of the Comprobify project in the dashboard. Also manually add `ADMIN_SECRET` to the new `comprobify-cron-production` group in the dashboard (same pattern as staging) — after that one-time step, all three production cron jobs inherit it automatically — see "Render Cron Job setup" under Scheduled jobs below

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

## Cloudflare configuration

### Email Obfuscation must be off on API subdomains

`GET /v1/tenants/agreements/:type` serves personalized agreement HTML (with the tenant's actual name/RUC and the `{{soporte.email}}`/`{{operador.email}}` contact addresses already baked into the stored snapshot — see ADR-018 / CLAUDE.md "Legal documents and tenant acceptance"). If the API subdomain is Cloudflare-proxied with Email Obfuscation enabled zone-wide, Cloudflare rewrites every email address in that HTML into a `<span data-cfemail="...">` placeholder and injects a relative `/cdn-cgi/l/email-protection` decode script. The frontend (comprobify-web) fetches this HTML server-side in a Next.js route handler and proxies it to the browser — the decode script then 404s because it's a relative path resolved against the *frontend's* domain, not the API's, so every obfuscated address renders as `[email protected]` instead of the real one.

Fix: a Cloudflare **Configuration Rule** scoped to just the API hostnames, with Email Obfuscation turned off:

| Setting | Value |
|---|---|
| Zone | `comprobify.com` |
| Rule name | Disable Email Obfuscation - App subdomains |
| Expression | `(http.host eq "api.comprobify.com") or (http.host eq "api-staging.comprobify.com")` |
| Action | Email Obfuscation → **Off** |

This leaves Email Obfuscation active on the marketing site (`comprobify.com`, `staging.comprobify.com`), where it's still useful, and only disables it on the API hostnames that actually serve HTML with real embedded email addresses.

`app.comprobify.com` / `app-staging.comprobify.com` (the frontend) are proxied through Vercel, not Cloudflare, so this rule doesn't need to — and can't — cover them.

> Applies to any Cloudflare-proxied API hostname serving `GET /v1/agreements/:type` or `GET /v1/tenants/agreements/:type` HTML. If a new API hostname is added later (e.g. a second staging environment), add it to this rule's expression too, or its agreement pages will silently break the same way.

---

## Scheduled jobs

The API has four scheduled jobs that must be triggered externally — none is self-scheduled. Both **staging** and **production** use a **Render Cron Job**, in the same workspace as the matching web service, so the scheduler is billed per execution-second and its logs sit alongside the API's own rather than depending on a third-party service with no SLA hitting an admin-protected endpoint. See `docs/infrastructure-costs.md` for the cost rationale. See `docs/guides/testing-scheduled-jobs.md` for how to exercise each job's scenarios locally by pushing dates into the past.

> Staging previously used [cron-job.org](https://cron-job.org) for the notifications job. It has been replaced by a Render Cron Job for the same reason production uses one, so both environments now follow the same pattern.

### `POST /v1/admin/jobs/notifications`

Runs two tasks on every call:

1. **Certificate expiry checks** — inspects `cert_expiry` for every active issuer across all non-suspended tenants and upserts `CERT_EXPIRING` / `CERT_EXPIRED` alerts. Auto-dismisses alerts when a certificate is renewed (> 30 days remaining).
2. **Webhook retry queue** — retries all webhook deliveries in `RETRYING` status whose `next_retry_at` has passed.

The job is **idempotent** — running it multiple times within the same minute is safe. Needs minute-level freshness, hence the 5-minute cadence.

### `POST /v1/admin/jobs/subscriptions`

Runs `subscriptionService.applyScheduledTierChanges()` then `subscriptionService.processDueRenewals()`, in that order (**must not** be reversed — see CLAUDE.md Common Mistake #27):

1. **Scheduled tier/interval changes** — applies any due downgrade or paid interval change (`pending_tier`/`pending_billing_interval` past `current_period_end`), rolling the period forward.
2. **Renewals** — opens renewal-due reminders (~7 days before `current_period_end`), and expires subscriptions to FREE if unpaid ~7 days past `current_period_end`.

Also idempotent. Daily cadence is enough — nothing here needs minute-level freshness the way the notifications job does.

### `POST /v1/admin/jobs/quota`

Runs `tenantQuotaService.resetDuePeriods()` — rolls over every tenant's document-quota period (`tenant_quotas`) whose `period_end` has passed: resets `document_count` to 0 and sizes the new cap from the tenant's current `subscription_tier`. Anchored to the OLD `period_end`, never "now," so a late-running job never drifts the cycle forward.

Independent of the billing cycle (`subscriptions.current_period_end`/`billing_interval`) on purpose — a YEARLY subscriber still needs their document quota refreshed every month, not once a year. See CLAUDE.md's "Document quota enforcement" entry for the full design.

Idempotent. Daily cadence is enough. Recommended to run after the subscriptions job in the same tick so a same-day tier change is reflected in the rolled-over cap, though this isn't a hard ordering requirement — a one-day-stale cap self-corrects on the next cycle.

### `POST /v1/admin/jobs/queue-reconciliation`

Runs `queueReconciliationService.runAll()` — see ADR-019 and CLAUDE.md's "Async SRI submission via RabbitMQ" entry for the full design. Finds documents whose dispatch to RabbitMQ was never confirmed or has gone stale, and **re-publishes** a fresh message for them — it never calls SRI itself, so a RabbitMQ outage or a missed publish only ever degrades to reconciliation-interval latency, not lost work:

1. **`PENDING_SEND` sweep** — re-publishes a `send` message for any document stuck in `PENDING_SEND` with no confirmed dispatch (or a stale one).
2. **`RECEIVED` sweep** — publishes an `authorize` message for any `RECEIVED` document old enough that SRI should have finished processing it, whether or not a client ever called `GET /:key/authorize` themselves.

Both sweeps run independently against `public.documents` and `sandbox.documents` (two `SELECT ... FOR UPDATE SKIP LOCKED` queries per sweep — Postgres disallows `FOR UPDATE` with `UNION`).

Idempotent. Needs a **shorter cadence than the other three jobs** — hourly, since this is the recovery mechanism for a temporarily unreachable broker or a publish that timed out. Not tighter than that: CloudAMQP is a managed service that rarely fails outright, and the worker already processes anything actually queued near-instantly — this job only bounds how long a document can sit unprocessed if nothing ever queued a message for it in the first place (a stuck publish, or a `RECEIVED` document nobody polled).

Declared in `render.yaml` as `comprobify-staging-queue-reconciliation`, same shape as the three jobs above, on a `0 * * * *` schedule — not yet synced against a real Render deploy, but low-risk since it's identical in structure to the three already-confirmed cron jobs.

### Render Cron Job setup — managed via Blueprint (`render.yaml`)

The three Cron Jobs are declared as code in `render.yaml` at the repo root, **not** created by hand in the dashboard. The API web services (`comprobify-staging`/`comprobify-production`) are deliberately excluded from this Blueprint and stay on the existing GitHub Actions deploy-hook pipeline above — only the cron jobs (low env-var count, low risk to manage declaratively) are in scope. Render auto-detects the project's `Dockerfile` for each service; the command runs as `node scripts/run-admin-job.js <path>` rather than a raw `curl` invocation, sidestepping the Docker Command field's lack of shell/quoting support (it splits on whitespace, so a `curl` call with a quoted `Authorization` header gets silently truncated — that's the cause if a run ever fails with a `SyntaxError`/truncated command).

**Render project structure:** everything lives in one Render **Project** ("Comprobify"), with a **Staging** environment (the API web service + the 3 cron jobs) today, and a **Production** environment with the same shape once provisioned (see below).

**Connecting the Blueprint (one-time):** In the Render dashboard, **New → Blueprint**, name it `comprobify-cron` (scoped name — this Blueprint only ever manages the cron jobs, not the web services), and connect it to this repo on the **`main`** branch.

The Blueprint's own connected branch (`main`) only controls where Render watches for changes to `render.yaml` itself (the job list/schedule/config) — it does **not** override each service's own `branch:` field below it, which independently controls what code that job actually runs. `main` is picked deliberately: config changes (adding a job, tweaking a schedule) land as soon as a PR merges, with no need to wait for a release/tag cycle, while each cron service still correctly runs from `branch: staging` (or `branch: production` later), matching whatever's actually live in that environment.

**`ADMIN_SECRET` is not declared in `render.yaml` at all — set by hand, directly in the dashboard, on the group.** Render's `envVarGroups` do not support `sync: false`: a secret declared there via YAML is silently dropped (no error, no prompt, it just never appears in the group). `ADMIN_SECRET` is instead added directly to the `comprobify-cron-staging` group in the Render dashboard, outside Blueprint management entirely — only the non-secret `API_BASE_URL` is actually declared in the file. **Confirmed** (not just theorized) to survive a Blueprint sync: a group variable absent from `render.yaml` is left alone, the same "never deletes what's not declared" guarantee Render's docs give for whole resources, now verified to extend to individual keys within a group too. Every current and future cron job referencing this group inherits `ADMIN_SECRET` with zero dashboard steps.

**Adopting the 3 jobs that already exist:** Render matches Blueprint service entries to existing dashboard resources **by exact name** — `render.yaml`'s 3 services are named `comprobify-staging-notifications`, `comprobify-staging-subscriptions`, `comprobify-staging-quota` to match what's already in the dashboard. `render.yaml` declares them at the root `services:` level rather than nested under a `projects`/`environments` block specifically because Render's docs guarantee root-level services "keep their currently assigned environment (if any) after each sync" — confirmed this holds for adoption (matching an existing resource by name preserves its Staging placement). **Confirmed the reverse also holds:** a brand-new resource (no prior assignment — e.g. if the dashboard originals were deleted first, so Render creates fresh ones instead of adopting) does **not** get auto-placed into the Staging environment; it lands ungrouped, needing one manual "move into Staging" step per service in the dashboard afterward. (A name mismatch on adoption would instead create 3 new duplicate services, since syncing never auto-deletes anything.)

**Adding a new scheduled job later:** add a new `type: cron` entry to the `services` list in `render.yaml` (see the existing three for the shape), referencing `comprobify-cron-staging` via `envVars: [{ fromGroup: comprobify-cron-staging }]`. Push to `main` and Render creates it — genuinely zero-touch for both `API_BASE_URL` and `ADMIN_SECRET`, no dashboard step at all, confirmed by the group behavior above.

**Suspending a job individually:** unaffected by Blueprint management — select the one service's checkbox in the dashboard and click Suspend/Resume, same as any Render service.

Reference table (schedules are also in `render.yaml`, this is just for readability):

| Job | Schedule | Command |
|---|---|---|
| Notifications | `*/5 * * * *` (every 5 minutes) | `node scripts/run-admin-job.js /v1/admin/jobs/notifications` |
| Subscriptions | `0 6 * * *` (daily) | `node scripts/run-admin-job.js /v1/admin/jobs/subscriptions` |
| Quota | `10 6 * * *` (daily, just after Subscriptions) | `node scripts/run-admin-job.js /v1/admin/jobs/quota` |
| Queue reconciliation | `0 * * * *` (hourly) | `node scripts/run-admin-job.js /v1/admin/jobs/queue-reconciliation` |

Production cron jobs aren't declared in `render.yaml` yet — see the file's own comments; add a `comprobify-cron-production` env var group and four more `branch: production` services (including the worker) once the production web service/branch/secrets exist (see "Production status" above).

> The `ADMIN_SECRET` for each environment is independent — never use the staging secret against the production endpoint.

### Response shapes

Notifications job:

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

Subscriptions job:

```json
{
  "ok": true,
  "applied": 2,
  "remindersSent": 5,
  "expired": 1
}
```

Quota job:

```json
{
  "ok": true,
  "quotaPeriodsReset": 4
}
```

Queue reconciliation job:

```json
{
  "ok": true,
  "sendRepublished": 1,
  "authorizeRepublished": 0
}
```

Monitor each Cron Job's execution log in the Render dashboard for non-zero exit codes (`curl -f` makes a non-2xx HTTP response fail the run). A sustained failure usually means the `ADMIN_SECRET` has rotated or the web service is down.

---

## Background worker (`workers/worker.js`)

Unlike the four scheduled jobs above — which are short-lived cron invocations that hit an HTTP endpoint and exit — `workers/worker.js` is a **long-running process** that holds a persistent connection to RabbitMQ and continuously consumes the `sri.send`/`sri.authorize` queues. It is the only code in the system that calls SRI directly (see ADR-019). It cannot be modeled as a Render Cron Job; it needs Render's **Background Worker** service type (or an equivalent persistent-process host), analogous to the existing web service but with no public port and started via `node workers/worker.js` (`npm run worker`).

Declared in `render.yaml` as `comprobify-staging-worker`, `type: worker` — confirmed synced against a real Render deploy (renamed from `comprobify-staging-sri-worker` when the worker's role broadened past SRI-only in ADR-022; see the file's own header comment for the manual re-adoption step that rename required). It reads from a dedicated `comprobify-worker-staging` env var group, which only declares the non-secret `APP_ENV` in the YAML; every actual required secret must be added by hand in the Render dashboard, on that group, the same way `ADMIN_SECRET` is handled for the cron jobs' group. The worker runs `validateCoreConfig()` at startup, not the API's full `validateConfig()` — a narrower set (`DB_*`, `RABBITMQ_URL`, `MAILGUN_API_KEY`/`MAILGUN_DOMAIN`/`EMAIL_FROM`), since its message handlers never touch admin auth, certificate encryption, billing, or inbound webhook verification. See CLAUDE.md Common Mistake list / `src/config/validate.js`.

**Error monitoring:** the worker also requires `instrument.js`, but Sentry's automatic uncaught-exception capture never fires for it — every failure path is already caught by the worker's own code. Two spots call `Sentry.captureException()` explicitly instead: a failure to register consumers after a (re)connect (connected but not consuming — worse than fully down, since it looks alive), and a fatal startup failure (the worker never came up at all, `process.exit(1)`) — the latter also flushes Sentry before exiting, since `captureException()` only queues the event rather than sending it immediately. Per-message SRI failures are deliberately console-only, not sent to Sentry, since they're expected/routine and already covered by the reconciliation job. `SENTRY_DSN` needs to be set on the worker's own env var group for any of this to actually report anywhere — see CLAUDE.md's "Error monitoring (Sentry)" entry for the full design.

Two additional signals worth knowing about, independent of Sentry: CloudAMQP's management UI shows live consumer count per queue (`sri.send`/`sri.authorize` at 0 consumers means the worker isn't connected, full stop), and the reconciliation job's `sendRepublished`/`authorizeRepublished` counts trending up across consecutive runs indicates something downstream of publish isn't keeping up, worker included.

There is no restart/health-check story documented yet for this process beyond whatever Render's Background Worker type provides by default (auto-restart on crash) — revisit once it's actually deployed and observed running for a while.

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
- When ready: create `comprobify-production` (its own web service + a production Neon Postgres project — see `docs/infrastructure-costs.md`), with independent env vars and secrets from staging — see "Production status" above
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
- [ ] If enabling the Cloudflare proxy, also add a Configuration Rule disabling Email Obfuscation for this hostname — see "Cloudflare configuration" below
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
| RabbitMQ | External broker (e.g. CloudAMQP) — required for the async SRI send/authorize pipeline. Not an npm dependency; the API and `workers/worker.js` both connect to it as a client (`amqplib`). |

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
| `EMAIL_FROM` | No | Bare sender email address for all non-invoice transactional emails, e.g. `notificaciones@mg.yourdomain.com`. Display name is hardcoded as `Comprobify <EMAIL_FROM>`. |
| `EMAIL_FROM_DOCUMENTS` | No | Optional separate bare sender address for invoice/document emails only, e.g. `comprobantes@mg.yourdomain.com`. Display name is built dynamically as `{Issuer Business Name} via Comprobify <EMAIL_FROM_DOCUMENTS>`. Falls back to `EMAIL_FROM` when unset. |
| `MAILGUN_API_KEY` | No | Mailgun private API key |
| `MAILGUN_DOMAIN` | No | Mailgun sending domain, e.g. `mg.yourdomain.com` |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | No | From Mailgun dashboard → Sending → Webhooks → Webhook signing key |
| `SENTRY_DSN` | No | Sentry project DSN — enables error monitoring (`@sentry/node`). Leave unset to disable; the client becomes a no-op and nothing is transmitted. Set independently per environment — staging and production should point at the same Sentry project but report distinct `environment` tags (derived from `APP_ENV`). |
| `BANK_TRANSFER_BANK_NAME` | No | Returned in the subscription-creation response (`POST /v1/tenants/promote` with `tier`, or admin's Create Subscription) so a tenant knows where to send the SPI transfer. Display text only, not a secret. |
| `BANK_TRANSFER_ACCOUNT_TYPE` | No | e.g. `AHORROS`, `CORRIENTE` |
| `BANK_TRANSFER_ACCOUNT_NUMBER` | No | |
| `BANK_TRANSFER_ACCOUNT_HOLDER` | No | |
| `BANK_TRANSFER_IDENTIFICATION` | No | Account holder's RUC/cédula |
| `RABBITMQ_URL` | Yes | AMQP connection string (e.g. from CloudAMQP), scoped to a dedicated vhost per environment. Required by both the API (publisher) and `workers/worker.js` (consumer) — without it the async SRI send/authorize pipeline can never dispatch a queued document. See "Background worker" below. |
| `RABBITMQ_SRI_EXCHANGE` | No | Name of the durable direct exchange used for SRI dispatch (default `sri.direct`) |
| `QUEUE_RECONCILE_SEND_STALE_MINUTES` | No | Minutes before an unconfirmed `PENDING_SEND` dispatch is considered stale and re-published (default `5`) |
| `QUEUE_RECONCILE_AUTHORIZE_DELAY_MINUTES` | No | Minimum age of a `RECEIVED` document before its first authorize-check is published (default `5`) |
| `QUEUE_RECONCILE_AUTHORIZE_STALE_MINUTES` | No | Minutes before an unconfirmed authorize-check dispatch is considered stale and re-published (default `5`) |
| `QUEUE_RECONCILE_BATCH_LIMIT` | No | Max rows processed per schema per reconciliation sweep (default `100`) |

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

### Rotating secrets (e.g. after a suspected compromise)

Not all three of `ADMIN_SECRET` / `ENCRYPTION_KEY` / DB credentials are equally safe to rotate — one of them can cause a real outage if done naively.

**`ADMIN_SECRET`** — safe, mechanical. It's only ever compared as a bearer token (`authenticate-admin.js`), never used to encrypt anything at rest. Update the value on the `comprobify-production` (or `-staging`) web service, and update the same value in the `comprobify-cron-production`/`comprobify-cron-staging` env var group in Render (one place per environment now, thanks to the group-based setup — every cron job inherits it, nothing to update per-service). No GitHub Actions secret currently holds a copy (confirmed — nothing in `.github/workflows/*.yml` references it). Old value stops working the moment the new one is saved; brief window where a leaked old secret and the new one might both be "in flight" during the update, but no data-level risk either way.

**DB credentials** — also low-risk. Rotate the password/role at the provider (Neon), update `DB_*` env vars on the web service, restart. No stored data depends on the credential value itself, only on being able to authenticate — a connection-level concern, not a data-level one.

**`ENCRYPTION_KEY` — dangerous, requires a real migration, do not just swap the env var.** This key is the only thing standing between `issuers.encrypted_private_key` (AES-256-GCM, `crypto.service.js`) and being unreadable garbage. Changing the env var value alone, without re-encrypting existing rows first, permanently breaks every existing issuer's ability to sign documents — a full outage for every already-onboarded tenant, not a gradual degradation. Correct rotation requires: decrypt every `issuers.encrypted_private_key` with the OLD key, re-encrypt with the NEW key, write it back, *then* cut the env var over — ideally as one script run before the restart, not manually. **No such script exists in this repo yet.** If `ENCRYPTION_KEY` is ever suspected compromised, that script needs to be written and tested (ideally against a copy of production data) before rotating for real — don't attempt this live for the first time during an actual incident.

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
