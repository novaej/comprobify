# Security Audit — 2026-09-12

First holistic security pass across CI/CD, deployment infrastructure, and application code, per `NEXT_STEPS.md` #5. Everything up to this point had been reviewed piecemeal as individual features shipped (RLS, rate limiting, attempt tracking, ADR-035's internal-service gate, etc.) — this is the first pass looking for gaps *between* those pieces.

**Methodology:** three parallel investigations (CI/CD, deployment infrastructure, application code), each tracing actual current file contents and — where relevant — live GitHub API state, rather than trusting what the docs claim about themselves. Findings below are organized by severity, then by area. Every finding cites file:line evidence found during this pass.

**Status:** investigation complete; the mechanical, no-design-decision fixes were applied the same day (#4, #7, #8, #10, #11 below — see each item for what changed). #1 requires a live GitHub configuration change that hit a billing-plan API error and needs to be completed via the GitHub UI (see #1). #2 and #3 need a decision (backup/retention policy; whether to redesign the rotation script's key-input mechanism now) before they can be fixed. #5, #6, #9, #12–16 remain open, tracked here.

---

## Priority summary

| Severity | # | Finding | Area |
|---|---|---|---|
| **High** | 1 | GitHub Environments (`production`, `production-infra`, `staging`, `staging-infra`) have **zero protection rules**, despite docs claiming a required-reviewer rule was added — verified live via `gh api`. `terraform apply -auto-approve` against production infra currently has no human approval gate. **Attempted same day** — `gh api` PUT to add a required-reviewer rule (owner as reviewer) failed with a billing-plan error even though the org is confirmed on GitHub Team; matches a known prior gotcha with this exact feature on this org (see earlier session history — resolved itself last time, cause unclear). **Still open** — needs to be added via the GitHub UI (Settings → Environments → `production-infra`/`staging-infra` → Required reviewers). | CI/CD |
| **High** | 2 | No real disaster-recovery/backup process for the production database — only a manual "pull a dump for local testing" guide. DB cluster is unmanaged by Terraform; no documented retention, no tested restore. **Still open** — needs a policy decision (retention/cadence) before it can be implemented. | Deployment |
| **High** | 3 | `scripts/rotate-encryption-key.js` — the incident-response tool for a suspected key compromise — takes both keys via `-e KEY=value` on the SSH/`docker compose exec` command line, landing them in shell history and the process list, on the same droplet an attacker may already have residual access to. No internal backup/rollback if the wrong new key is committed. **Still open** — needs a decision on the redesign (stdin prompt vs. short-lived file) and is also blocked on #2 (a documented backup/restore path) before the "no rollback" half can be closed. | CI/CD + Deployment |
| **Medium** | 4 | Third-party GitHub Actions (`appleboy/ssh-action`, `appleboy/scp-action`, `hashicorp/setup-terraform`, `cloudflare/wrangler-action`) pinned to mutable version tags, not commit SHAs — a compromised maintainer account could re-point a tag and exfiltrate every production secret with no diff in this repo to review. **Fixed 2026-09-12** — all 9 usages across `deploy-production.yml`, `deploy-staging.yml`, `terraform.yml` (×4), and `docs.yml` now pin to the commit SHA current as of that tag, with the version kept as a trailing comment for readability. | CI/CD |
| **Medium** | 5 | No Docker image digest pinning (`node:20-slim`, `caddy:2-alpine`, `redis:7-alpine`) and no vulnerability scanning (Trivy/Grype/Snyk) anywhere in CI. Still open. | CI/CD |
| **Medium** | 6 | No `npm audit` in CI, no `.github/dependabot.yml`, no auto security updates. Passive Dependabot alerts are on at the repo level, but nothing acts on them automatically. Still open. | CI/CD |
| **Medium** | 7 | `sequential.service.js`'s `initialize()` unconditionally uses `db.query()` against the RLS-protected `sequential_numbers` table — the one function in that file that doesn't set issuer context, reachable from ordinary tenant registration/branch-creation/promotion flows. Not currently cross-tenant-exploitable (every call site passes a freshly-created, tenant-owned issuer id), but a real, present-day violation of the RLS invariant. **Fixed 2026-09-12** — `initialize()` now goes through `db.queryAsIssuer`, matching its three siblings (`getNext`/`getCounters`/`setNext`) in the same file; the manual `sandbox ? 'sandbox.sequential_numbers' : ...` table-name interpolation was replaced by `queryAsIssuer`'s own `search_path` handling. | Application |
| **Low–Medium** | 8 | `attempt-tracker.service.js` doesn't track `INSUFFICIENT_SCOPE` or `ISSUER_FORBIDDEN` failures — exactly the "a compromised key is being probed against other tenants' data" signal the mechanism exists to catch. Account-recovery failures are untracked by design (anti-enumeration), which is correct. **Fixed 2026-09-12** — both event types added to `AttemptEventTypes`, wired into `require-scope.js` (keyed by `req.apiKey.id`, fire-and-forget) and `resolve-issuer.js` (same key, awaited — matches each middleware's existing sync/async style). | Application |
| **Low** | 9 | `echo "${{ secrets.GITHUB_TOKEN }}" | docker login ... --password-stdin` on the droplet places the (ephemeral, narrowly-scoped) token as a literal process argument for an instant. GitHub's log masking prevents it reaching the Actions log. Still open — low priority. | CI/CD |
| **Low** | 10 | Agreement markdown rendering substitutes tenant-controlled `business_name`/`ruc` via the plain (non-HTML-escaping) `substitute()` instead of `substituteHtml()`. Not currently exploitable — markdown-it's `html:false` default blocks script/attribute injection — but a tenant's business name can still inject markdown formatting into their own legal-agreement snapshot, and the safety property depends entirely on that default never changing. **Fixed 2026-09-12** — `agreement.service.js`'s `substitutePlaceholders()` gained an `escapeValues` option (uses `substituteHtml()` internally); `tenant-agreement.service.js`'s `generateForTenant()` (the one call site substituting tenant-controlled `cliente.*` values) now passes `{ escapeValues: true }`. Verified empirically with the installed `markdown-it` that this doesn't double-encode ampersands/entities. **Note:** this closes the HTML/attribute-injection angle as defense-in-depth; it does *not* neutralize markdown *syntax* (`**bold**`, `# heading`, `---`) in a tenant's business name, which was and remains a separate, lower-value content-spoofing concern on the tenant's own document — out of scope for this fix. | Application |
| **Low** | 11 | `src/services/email/templates/verify-email.js` is the one email template with no `escapeHtml()` at all, interpolating the client-supplied `verificationRedirectUrl` into link `href`/text. Mitigated by `isURL()` validation (blocks `"`, `<`, `>`, whitespace, non-http(s) schemes) and by the route being gated behind `requireInternalService` — but there's no allow-listed-host check, so a syntactically valid `https://attacker.example/verify` could be used for phishing by whoever holds the internal-service secret. **Fixed 2026-09-12** — added the same local `escapeHtml()` helper every other template uses, applied to the URL in both link text and `href`. The allow-listed-host gap remains open (a separate, larger design question). | Application |
| **Low** | 12 | The ephemeral `GITHUB_TOKEN` used for `docker login` on the droplet persists (base64, not encrypted) in `~/.docker/config.json` under the deploy user's home directory — a second secret-at-rest location outside the documented "one flat `.env` file" model. | Deployment |
| **Low** | 13 | Terraform state bucket's private ACL / encryption is a manual, one-time dashboard step with no automated drift detection. | Deployment |
| **Informational** | 14 | Admin API key minting (`admin.service.js`'s `createApiKey`) always grants `ALL_SCOPES` with no option for a narrower support-desk key — acceptable given the separate `ADMIN_SECRET` trust boundary, but worth adding for least-privilege support tooling. | Application |
| **Informational** | 15 | Buyer PII (`documents.buyer_*`, `request_payload`) and `payment_proofs.file` (bank-transfer receipts, routinely containing account numbers) rest on DB-disk-encryption only — same as everything except `issuers.encrypted_private_key`. Matches CLAUDE.md's own documented scope; flagged here as the two highest-value candidates if application-layer encryption is ever extended. | Application |
| **Informational** | 16 | No host-level firewall (ufw/iptables) behind the DO Cloud Firewall — deliberate, already documented trade-off. No auto-reboot after a security patch that requires one (patches install via unattended-upgrades but a pending reboot isn't automatic). | Deployment |
| **Clean** | — | SQL injection (Common Mistake #2's rule holds, no exceptions found), RIDE PDF generation, Mailgun webhook signature verification (no bypass path), Payphone's payment-confirmation design (sound server-to-server model, not a naive webhook-trust pattern), Caddy/TLS config, container network exposure (Redis/API never published, DO firewall + `expose`-only as two independent layers), SSH exposure model (matches documentation exactly — key-only auth, no root, fail2ban active, unattended-upgrades active). | All |

---

## High-severity findings

### 1. GitHub Environment protection rules are absent, contrary to documentation

`docs/production-readiness-checklist.md:18` and `docs/terraform-digitalocean-setup.md:776` both state the `production-infra` required-reviewer rule was added *before* `DO_TOKEN`/`CLOUDFLARE_TOKEN` were configured. Live verification (`gh api repos/novaej/comprobify/environments/production-infra` etc., run with confirmed admin permissions):

```
production:        protection_rules: []
production-infra:   protection_rules: []   ← DO_TOKEN, CLOUDFLARE_TOKEN both live here
staging:            protection_rules: []
staging-infra:      protection_rules: []
```

All four environments have `deployment_branch_policy: null` too — no branch restriction beyond what each workflow's own trigger already enforces. `production-infra` was created 2026-09-09; the checklist commit checking this item off landed 2026-09-11 — so this isn't a stale doc predating the environment. Either the rule was configured and later removed, or the checkbox was marked without the UI step happening.

**Impact:** `terraform.yml`'s `apply-production` job (`environment: production-infra`) runs `terraform apply -auto-approve` against real DigitalOcean/Cloudflare infrastructure. Right now, nothing requires a human to approve that run before it executes — a push to `main` touching `terraform/**`, or a `workflow_dispatch`, goes straight through.

**Fix:** add a required-reviewer rule to `production-infra` (and `staging-infra`) via Settings → Environments, or via `gh api repos/novaej/comprobify/environments/production-infra` with a `reviewers` payload. Needs a decision on who the required reviewer(s) should be. Also worth reverting the two checklist items to unchecked until re-verified live, and normalizing `can_admins_bypass` (currently inconsistent: `true` on three environments, `false` on `staging-infra`).

### 2. No verified disaster-recovery/backup process for the production database

`docs/guides/database-backups.md` is titled "Getting an Importable Dump from Staging/Production" — it's a manual, human-run `pg_dump` procedure for pulling a local copy to test things like the encryption-rotation script, explicitly instructing the operator to delete the dump and revoke DB access afterward. It is not a scheduled backup mechanism and not a disaster-recovery restore runbook.

The Managed Postgres cluster itself has no Terraform resource at all (confirmed: no `digitalocean_database` anywhere under `terraform/`) — it's provisioned and managed entirely by hand, so whatever backup/retention DigitalOcean's platform applies by default has never been reviewed or confirmed for either environment. No mention of backup retention, RPO/RTO targets, or a tested restore drill exists anywhere in `docs/`.

**Fix, before real tenant data flows:** (1) confirm what DO Managed Postgres backup/retention settings are actually active on the production cluster (DO dashboard), (2) document a periodic, automated backup process with a defined retention policy, (3) run at least one real restore drill and record the result.

### 3. Encryption-key-rotation script exposes both keys during the exact scenario where that's most dangerous

`docs/guides/encryption-key-rotation.md:52,56` documents the run command as:
```
docker compose exec -T -e OLD_ENCRYPTION_KEY=<current> -e NEW_ENCRYPTION_KEY=<new> ...
```
run over an SSH session to the droplet. Both values land in shell history and the process list for the duration of the command. The doc already self-flags this as a known, "acceptable for now" gap — but this tool's actual purpose is incident response to a suspected key compromise, which is precisely the scenario where an attacker with residual droplet access is most likely to be watching `ps`/history in real time. The tool built to recover from a compromise currently leaks the recovery material through the same channel a compromise would exploit.

Separately: `scripts/rotate-encryption-key.js` itself is well-built where it matters — the whole rotation runs inside one Postgres transaction with `SELECT ... FOR UPDATE`, so a mid-rotation crash rolls back cleanly and no row is ever left on a mixed old/new key (verified: `scripts/rotate-encryption-key.js:99-136`). `--dry-run` is genuinely a no-op against the database (issues `ROLLBACK` unconditionally, skips the `UPDATE` entirely). What's missing is protection against committing an *unintended-but-well-formed* new key (a typo, or the wrong key file) — the round-trip check only catches implementation bugs in the script itself, not operator error, and there's no internal backup/snapshot taken before the `UPDATE` runs.

**Fix:** read both keys from stdin (interactive prompt) or a short-lived `chmod 600` file deleted immediately after use, instead of `-e KEY=value` on the command line. Add a documented pre-flight step (snapshot the affected rows, or take a fresh DB backup) as a hard prerequisite before any real (non-dry-run) invocation — this is also blocked on finding #2 above being closed first.

---

## Medium-severity findings

### 4. Third-party GitHub Actions pinned to tags, not commit SHAs

Every `uses:` line across all 6 workflow files uses a mutable version tag (`@v5`, `@v1`, `@v0.1.7`, `@v3`, `@v4`) — none reference a full commit SHA. The two of concern: `appleboy/ssh-action`/`appleboy/scp-action` (`.github/workflows/deploy-production.yml:42,52`, `deploy-staging.yml:26,28,46,61`) directly handle `INFRA_SSH_PRIVATE_KEY` and write the droplet's entire `.env` (every production secret) — if either maintainer's tag were ever re-pointed (compromised account, compromised tooling), the next deploy run would exfiltrate everything with zero code change in this repo to catch it in review. `hashicorp/setup-terraform` similarly runs inside jobs holding `DO_TOKEN`/`CLOUDFLARE_TOKEN`.

**Fix:** pin `appleboy/ssh-action`, `appleboy/scp-action`, `hashicorp/setup-terraform`, and `cloudflare/wrangler-action` to commit SHAs (comment the version tag alongside for readability). Consider Dependabot's `github-actions` ecosystem (see #6) to keep SHA pins current without manual tracking.

### 5. No Docker image digest pinning or vulnerability scanning

`Dockerfile:1` (`node:20-slim`), `deploy/docker-compose.yml:3` (`caddy:2-alpine`), `deploy/docker-compose.yml:66` (`redis:7-alpine`) are all mutable tags, not digests — these get rebuilt upstream regularly and can change contents silently between builds. No workflow runs Trivy/Grype/Snyk/Docker Scout; the build step goes straight from `docker build` to `docker push` with nothing in between. (The app's *own* image is fine — it's tagged with `github.sha` per deploy, effectively content-addressed.)

**Fix:** pin the three base images to digests with a scheduled job checking for upstream updates; add a Trivy scan step before `docker push`, failing/warning on HIGH/CRITICAL findings.

### 6. No `npm audit`, Dependabot config, or Snyk in CI

No workflow runs `npm audit`; no `.github/dependabot.yml` exists; no audit script in `package.json`. Live check: `dependabot_security_updates` is `disabled` at the repo level, as are `code_security`/`secret_scanning`/`secret_scanning_push_protection` — but passive Dependabot *alerts* (not auto-PRs) are actually on.

**Fix, in order of effort:** add `.github/dependabot.yml` (npm + github-actions ecosystems), enable `dependabot_security_updates`, add an `npm audit --audit-level=high` CI step, consider secret scanning + push protection given the number of long-lived credentials this repo handles.

### 7. `sequential.service.js`'s `initialize()` bypasses RLS

`getNext()`, `getCounters()`, and `setNext()` in the same file all correctly call `db.queryAsIssuer`/`db.setIssuerContext`. `initialize()` (`src/services/sequential.service.js:78-87`) doesn't — it's a plain `db.query()` against `sequential_numbers`, an RLS-protected table. Reachable from tenant registration (`registration.service.js:156-165`), issuer/branch creation (`issuer.service.js:172-181`), and promotion (`tenant.service.js:95`) — all ordinary tenant-authenticated flows, not the documented webhook/admin/health exemption.

Every current call site passes a freshly-created, tenant-owned issuer id, so there's no observed cross-tenant leak today — but this removes RLS as a defense-in-depth backstop on this write path entirely (the RLS policy's null-bypass means *no* row-level restriction applies when no issuer context is set). If a future change lets `issuerId` be influenced by anything other than a just-created row, this function has zero protection while its three siblings in the same file do.

**Fix:** mechanical — have `initialize()` take/set issuer context the same way its siblings do.

---

## Low–Medium and Low findings

### 8. `attempt-tracker.service.js` coverage gaps

4 event types are wired: `API_KEY_AUTH_FAILURE`, `ADMIN_AUTH_FAILURE`, `INTERNAL_SERVICE_AUTH_FAILURE`, `MAILGUN_WEBHOOK_INVALID_SIGNATURE`, plus `RECOVERY_SUCCESS` (a success-anomaly signal). Two gaps worth closing:

- **`INSUFFICIENT_SCOPE`** (`src/middleware/require-scope.js`) — never tracked. A key repeatedly probing routes outside its own scopes generates no signal.
- **`ISSUER_FORBIDDEN`** (`src/middleware/resolve-issuer.js:39-41`) — never tracked. A key repeatedly sending `X-Issuer-Id` values belonging to *other tenants* is one of the clearest indicators of a compromised key being probed, and it's currently invisible.

Account-recovery *failures* are deliberately untracked (the endpoint is anti-enumeration by design — recording only success is correct, matches `registration.service.js`'s stated intent). Not a gap.

**Fix:** wire both gaps into `attemptTrackerService.recordEvent()` following the existing 4-site pattern (`ipKeyGenerator(req.ip)` or `req.apiKey.id` as the key).

### 9–13. Lower-priority items

- **#9** (`docker login` token on process list) — ephemeral, narrowly-scoped `GITHUB_TOKEN`, masked in logs. Cleaner form: read from an exported env var rather than inlining `${{ }}` into the command.
- **#10** (agreement markdown, tenant business name via `substitute()` not `substituteHtml()`) — not exploitable today (markdown-it's `html:false` default), but should use `substituteHtml()` as defense-in-depth so it isn't one config change away from stored XSS.
- **#11** (`verify-email.js` missing `escapeHtml()`) — mitigated by `isURL()` validation + `requireInternalService` gate; add `escapeHtml()` anyway, and consider allow-listing the redirect host.
- **#12** (GHCR token in `~/.docker/config.json` on droplet) — low, same ephemeral/narrow-scope reasoning as #9.
- **#13** (Terraform state bucket privacy unverified by automation) — one-time manual dashboard step, no drift detection; worth a one-off confirmation via `doctl`/dashboard.

---

## Informational

- **#14** — admin key minting always grants `ALL_SCOPES`; acceptable given the separate admin trust boundary, worth an optional narrower-scope parameter for support tooling later.
- **#15** — buyer PII and payment-proof files rest on DB-disk-encryption only, same as everything except the issuer private key. This matches CLAUDE.md's documented scope already; noted here as the two highest-value candidates *if* application-layer encryption is ever extended.
- **#16** — no host firewall behind the DO Cloud Firewall (deliberate, documented); no auto-reboot after a patch requiring one.

## Confirmed clean

SQL injection (no exceptions to the parameterized-query rule found, including dynamic `ORDER BY`/schema-prefix cases — all gated through fixed allow-lists), RIDE PDF generation, Mailgun webhook signature verification (single registration point, no bypass), Payphone's payment confirmation (sound server-to-server design — the tenant's browser only supplies an identifier, the actual state comes from Comprobify calling Payphone's API directly), Caddy/TLS configuration, container network exposure (Redis and the API are never published to a host port at all, backed by an independent DO Cloud Firewall layer with no rule for those ports either), and the SSH exposure model (matches documentation exactly: open 22 is a deliberate trade-off, but key-only auth + no root + fail2ban + unattended-upgrades + per-environment unprivileged deploy users are all genuinely active, not just documented intent).

---

## Next steps

This was an in-house pass, not a professional pentest. Per `NEXT_STEPS.md` #5's own framing, consider whether an external pentest is warranted before real tenant data is at stake — this document is a reasonable basis for scoping one (it already covers the areas a pentest would start from) but doesn't replace one.

**Fixed same day (2026-09-12):** #4 (SHA-pinned the 4 third-party actions), #7 (RLS bypass in `sequential.service.js`), #8 (attempt-tracker wiring for `INSUFFICIENT_SCOPE`/`ISSUER_FORBIDDEN`), #10 (agreement markdown `escapeValues`), #11 (`verify-email.js` `escapeHtml`). All 1095 unit tests pass after these changes.

**Still open, needs your input:**
- **#1** — the `gh api` attempt to add a required-reviewer rule to `production-infra`/`staging-infra` failed with a billing-plan error despite the org being on GitHub Team (a repeat of an earlier gotcha with this exact feature on this org). Needs to be added via the GitHub UI: Settings → Environments → `production-infra` (and `staging-infra`) → Required reviewers → add yourself. **This is the single most urgent open item** — until it's done, `terraform apply` against production infrastructure has no approval gate.
- **#2** — needs a backup/retention policy decision (what DO Managed Postgres backup settings are actually active, what retention window, and a real tested restore).
- **#3** — needs a decision on redesigning `rotate-encryption-key.js`'s key-input mechanism (stdin prompt vs. short-lived file) and is partly blocked on #2.
- **#5, #6** — Docker image scanning/pinning and `npm audit`/Dependabot config; no design decision needed, just scheduling the work.
- **#9, #12–16** — low/informational, no urgency.
