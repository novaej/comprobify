# Next Steps

Remaining work ordered by value-to-effort ratio. Each item is independent and can be delivered as its own PR.

---

## 1. Additional Document Types

**Priority: High — required for full SRI compliance**

Facturas (`01`) and notas de crédito (`04`) are supported. The builder registry pattern makes adding new types straightforward, but each type needs its own validator — see "Adding a new document type" in `docs/guides/coding-guidelines.md`.

**Priority order:**
- `07` — Comprobante de retención (retention voucher)
- `05` — Nota de débito (debit note)
- `03` — Liquidación de compra
- `06` — Guía de remisión

**Per new type:**
1. New builder class in `src/builders/` extending `BaseDocumentBuilder`
2. One registry entry in `src/builders/index.js`
3. New XSD asset in `assets/` (download from SRI portal), added to `XSD_PATHS` in `xml-validator.service.js`
4. New validator file reflecting that type's actual required fields (do not bolt onto `createInvoice`'s `isIn([...])`); register it in `src/middleware/select-document-validator.js`
5. Add the type's label to `helpers/ride-builder.js` and `src/locales/{es,en}.js`'s `email.invoiceAuthorized.documentTypeLabels`

Creation and rebuild services already guard invoice-only logic (e.g. the payments-total check) behind `Array.isArray(body.payments)`, so they need zero changes unless the new type introduces another invoice-only assumption. Transmission and query services need zero changes.

---

## 2. Reporting

**Priority: Low — depends on client requirements**

Not a core API feature. Only worth building once a client explicitly needs it.

**What:**
- Revenue summaries by issuer, date range, document type
- **Consider excluding the operator's own tenant from income/revenue figures** — it's set to a high tier via the admin override (`PATCH /v1/admin/tenants/:id/tier`) but pays nothing to use the system, so counting it would inflate tenant counts and distort revenue/MRR. No dedicated mechanism for this today (identify it by email or tenant id when writing the query) — revisit if this ever needs to be more robust than that.
- Document counts by status
- CSV export

**Effort:** Medium — multiple query endpoints, no architectural changes needed.

---

## 3. Payment Gateway Integration

**Status: Mostly done. Card payments shipped via Payphone's Cajita de Pagos — see ADR-028, `src/services/payphone.service.js`/`payphone-payment.service.js`, `src/models/payphone-transaction.model.js`, migrations 091/092, and `docs/guides/payphone-payments.md`.** This item originally assumed a KYC-gated, native-recurring gateway and stayed unscoped until "the entity exists and a vendor is chosen" — worth asking the operator directly why Payphone cleared that bar when other production-checklist items (#19–20) are still blocked on the legal entity: either Payphone's onboarding requirements turned out lighter than a card processor typically demands, or there's KYC exposure here that hasn't been reconciled with the entity-formation blocker elsewhere. Don't assume either answer.

**Shipped**, matching this item's original scope:
- A hosted widget (Cajita de Pagos) tokenizes client-side — raw card data never reaches Comprobify's servers.
- Every payment purpose (`INITIAL`, `TIER_CHANGE`, `RENEWAL`) is card-payable, applied through the exact same `subscriptionService.applyVerifiedPayment()` a manual SPI transfer uses — no gateway-specific activation logic exists or is needed.
- Gateway-specific config (`PAYPHONE_TOKEN`/`PAYPHONE_STORE_ID`) follows the `REDIS_URL`/`SENTRY_DSN` optional-and-independent-per-environment pattern, not `ADMIN_SECRET`/`ENCRYPTION_KEY`'s always-required one — unset means `503 PAYMENT_GATEWAY_NOT_CONFIGURED` and SPI stays untouched, so a missing credential can never take billing down.
- The operator invoicing queue, refund/reversal endpoint, and mid-cycle tier-change proration all work unmodified for a card payment — same reasoning as the bullet above.

**Not applicable, and why:** the Cajita is a one-shot checkout widget, not a gateway with native recurring subscriptions or a charge-schedule of its own. This item originally assumed a gateway that "owns the charge schedule" and would make the manual renewal cron redundant for a gateway-paying tenant — that premise doesn't hold for Payphone. `subscriptionService.processDueRenewals()` (`POST /v1/admin/jobs/subscriptions` — reminder ~7 days before `current_period_end`, expiry ~7 days after if unpaid) remains fully load-bearing for every tenant regardless of payment method: a card-paying tenant still gets a renewal reminder and still pays it by opening the Cajita again, same as a bank-transfer tenant re-uploads proof. There is no gateway-initiated recurring charge to react to, so the originally-scoped "failed recurring charge → downgrade" webhook handling was never built and isn't needed as designed.

**Remaining option, not yet built:** Payphone's optional *External Notification* webhook (requires requesting authorization from them) would replace `payphone-payment.service.js`'s polling reconciliation sweep (`reconcileStaleTransactions`, ~5-minute cadence) with a push, mirroring `verify-mailgun-webhook.js`'s signature-verified pattern. Whether it also reports cardholder chargebacks/reversals would decide whether reversal detection (today entirely manual for both payment methods, per ADR-028's "Negative / trade-offs") can ever be automated. Worth its own scoped item if the operator wants to request access — see ADR-028's "Neutral" section.

---

## 4. Overage Billing (Per-Tenant Toggle + Charging)

**Priority: Low-Medium — re-evaluated now that #3 shipped. No longer blocked on "a gateway exists"; the remaining blocker is just building this feature's own pieces.**

This item used to say "blocked on #3" on the assumption that charging an overage line item required a payment gateway that didn't exist yet. That premise is gone: Payphone (#3) can charge any existing `payments` row today, but — important nuance — **overage billing was never actually gateway-blocked even before Payphone**, because the manual SPI-transfer/proof-upload pipeline already lets a tenant pay an arbitrary `payments` row without any gateway at all (exactly how `RENEWAL`/`TIER_CHANGE` payments work right now). What Payphone adds is a *nicer* collection path — the tenant can settle an overage charge by opening the Cajita immediately instead of uploading a bank transfer screenshot and waiting on operator review — not a *newly possible* one. So the real remaining blocker was always this item's own unbuilt pieces, not #3; re-scoping it here since #3 shipping is what prompted a second look.

The monthly-quota-reset prerequisite this item used to require is already built (`tenant_quotas`, see CLAUDE.md's "Document quota enforcement" entry) and just got more capable: migration 094 (see ADR-029) made `tenant_quotas.document_quota` nullable, and `incrementIfWithinCap`'s gate is now `document_quota IS NULL OR document_count < document_quota` — a `NULL` cap already means "never block, keep incrementing `document_count` anyway for visibility." An overage-enabled tenant's mid-cycle behavior is structurally the same shape (keep counting past a nominal cap instead of blocking); the difference is that overage stays *billed*, so it needs a real bounded cap concept and a counter split between "quota-covered" and "overage" documents, which `tenant_quotas` doesn't track today (it has one `document_count`, not two).

**What:**
1. **Per-tenant overage toggle** — add `tenants.overage_enabled` (boolean). This must be opt-in, not automatic: some tenants will want a hard cap with zero surprise charges (today's behavior — keep it as the default), others will prefer to keep issuing and pay the overage rate rather than get blocked mid-month.
2. **Overage tracking** — `document-creation.service.js`'s quota check needs a third outcome alongside "within cap" / "blocked": *"over cap, but `overage_enabled`"* — still increments `document_count` (or a new `overage_count` column, so a plan tier's own quota consumption stays separately visible from paid overage) rather than throwing `QuotaExceededError`.
3. **Overage charging** — bill the cycle's accumulated overage as one line item (`overage_count × overagePerDocumentUsd`) at cycle end (`tenantQuotaService.resetDuePeriods()`'s daily job is the natural place to check for pending overage before rolling the period over), via a new `payments.purpose` value (e.g. `'OVERAGE'`) routed through the exact same manual-proof-or-Payphone-card pipeline every other purpose already uses — not a per-document charge; nothing here needs a new billing mechanism, just a new purpose value flowing through the existing one.
4. Expose the toggle (e.g. `PATCH /v1/tenants/overage`) and surface current-cycle overage usage somewhere the tenant can see it before the bill arrives, so it's never a surprise.

**Effort:** Medium — the toggle endpoint, the counter/tracking split, and wiring a new payment purpose through `applyVerifiedPayment`'s existing dispatch — no new payment infrastructure required.

---

## 5. Full Security Audit — CI/CD, Deployment, and Application

**Priority: High — should happen before real production tenant data is flowing, not treated as a someday item.**

Everything security-related so far has been reviewed piecemeal, as individual features shipped (RLS, rate limiting, attempt tracking, RFC 7807 error codes, etc. — see CLAUDE.md's various entries and ADR-012/ADR-026). Nobody has done one holistic pass looking for gaps *between* those individually-reviewed pieces. Two halves, both needed:

**CI/CD and deployment processes:**
- GitHub Actions: third-party actions (`appleboy/ssh-action`, `appleboy/scp-action`, `hashicorp/setup-terraform`, `docker/login-action`, etc.) pinned to a version tag, not a commit SHA — check whether that's an acceptable risk or worth tightening; confirm no workflow step ever echoes/logs a secret value even indirectly
- `production-infra` GitHub Environment must get its required-reviewer rule added *before* any real `DO_TOKEN`/`CLOUDFLARE_TOKEN` secrets land in it (see `docs/production-readiness-checklist.md`) — verify this ordering actually happened, don't assume
- The droplet's `/opt/comprobify/.env` is a single flat file holding every secret the app uses — anyone who gets shell access as the deploy user gets all of them at once. Acceptable trade-off for the current scale (see the "is having the values there secure?" discussion this came out of), but worth revisiting whether a dedicated secrets manager (Vault, DO's own secret injection, etc.) is warranted as the tenant base grows
- `scripts/rotate-encryption-key.js`'s documented gap: `OLD_ENCRYPTION_KEY`/`NEW_ENCRYPTION_KEY` typed on the SSH command line land in shell history and the droplet's process list — fix before this is ever run against a real suspected compromise (see `docs/guides/encryption-key-rotation.md`)
- Docker base images (`node:20-slim`, `caddy:2-alpine`, `redis:7-alpine`) — no vulnerability scanning (Trivy/Grype/Dependabot) currently wired into any workflow; images aren't pinned to a digest, just a tag
- SSH open to `0.0.0.0/0` on the droplet is a deliberate, documented trade-off (see `docs/terraform-digitalocean-setup.md`'s "SSH access model") — re-confirm the layered defenses (key-only auth, no root, fail2ban, unprivileged deploy user) are still sufficient rather than assuming the original reasoning still holds
- `npm audit` / Dependabot / Snyk (or similar) isn't currently run anywhere in CI — dependency vulnerabilities could ship unnoticed

**Application:**
- Standard OWASP-class review: confirm no exceptions exist to the parameterized-SQL-only rule (CLAUDE.md #2), check for XSS in any user-controlled content that reaches HTML (agreement pages, RIDE PDFs, email templates), re-verify RLS has no bypass path beyond the documented `db.query()`-exempt code paths (webhook, admin API, health check)
- Scope-escalation and privilege-boundary edge cases in the API key scope system (`src/constants/api-key-scopes.js`, `api-key.service.js`'s containment check)
- Whether `attempt-tracker.service.js`'s detection coverage (currently 4 event types) should extend to other sensitive endpoints
- Encryption-at-rest scope: only `issuers.encrypted_private_key` is encrypted today — review whether other stored PII (buyer data, RUCs) needs the same treatment or whether DB-level encryption-at-rest (DO Managed Postgres's own disk encryption) is judged sufficient for those
- Webhook signature verification correctness end-to-end (Mailgun HMAC) — not just that it exists, but that it's actually enforced on every code path that claims to require it

**Effort:** Large — this is genuinely a full audit, not a quick pass. Consider whether external/professional pentest is warranted before real tenant data is at stake, versus doing the first pass in-house and hiring out a follow-up. The `security-review` skill can cover incremental "review this branch's diff" work along the way, but isn't a substitute for the holistic pass this item describes.

