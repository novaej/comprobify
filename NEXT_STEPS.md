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
- **Exclude the operator's own tenant** — it holds a paid tier with no payments behind it, so including it inflates tenant counts and distorts revenue. Needs the `OPERATOR_TENANT_ID` pointer from #5; worth doing together rather than retrofitting.
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

## 5. Operator Tenant as a First-Class Concept

**Priority: Low now, rising — becomes real the moment reporting (#2) exists, or the operator's own quota runs out**

The operator is a tenant in the system: they need a tenant row and an issuer to self-bill subscription invoices from. But nothing can *tell* that row apart from a customer's. `config.operator` (`src/config/index.js`) holds identity strings only — `OPERATOR_NAME`/`RUC`/`EMAIL`/`ADDRESS`, used for legal-document token substitution and the "RUC Proveedor" `infoAdicional` field — with no `OPERATOR_TENANT_ID` or `OPERATOR_ISSUER_ID` anywhere. Every tenant-scoped mechanism therefore treats the operator as an ordinary paying customer.

Concrete consequences today:

- **Quota.** `document-creation.service.js` calls `tenantQuotaService.consumeOne()` for every production document with no exemption, so the operator burns their own quota issuing subscription invoices *to* customers — one per paying tenant per month, on top of any real invoicing they do. Exhausting it makes subscription invoicing fail with `402 QUOTA_EXCEEDED`, which reads like a bug rather than a cap.
- **Subscription lifecycle.** If an operator tenant ever gets a `subscriptions` row, `processDueRenewals()` will open `RENEWAL` payments for it, email the operator renewal reminders about themselves, and eventually mark their own account `PAST_DUE` for not paying themselves. Avoided today only by never creating one — a convention nothing enforces.
- **Price-change announcements.** `pricingService.publishPrice()` / `reconcilePendingPriceChangeNotifications()` scan `findAllByStatus(ACTIVE)`, so publishing a price change emails the operator a 30-day notice about their own price change.
- **Reporting (#2), and this needs care.** The operator's tenant is not a bookkeeping fiction — it is a real business issuing real invoices, both the subscription invoices it sends Comprobify customers *and* invoices for the operator's other work to unrelated clients. So "exclude the operator" is the wrong instruction, and applying it bluntly trades one wrong number for another:
  - **Subscription/MRR reporting must exclude it.** It holds a paid tier with no payment behind it — money moving from one pocket to the other — so counting it inflates tenant counts and distorts MRR/ARR.
  - **Document/usage reporting must NOT exclude it.** Those documents are genuine system activity; dropping them undercounts real load and real usage.
  - **The operator's own invoiced work is not Comprobify revenue at all.** It is the operator's business income, a different figure that happens to flow through the same system. Never let it land in a "Comprobify revenue" number.

  Getting any of these wrong is quiet: the numbers look plausible and are simply off.

**What:**
1. **Model it in two places that must agree**, because the failure mode is expensive and quiet: if the wrong tenant is ever marked as the operator, a real paying customer silently stops being billed, drops out of MRR, and gets uncapped quota — a revenue leak nothing surfaces.

   - **`tenants.kind`** — `VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER'`, CHECK-constrained to `CUSTOMER` / `OPERATOR` / `INTERNAL` / `DEMO`. This is the queryable fact every report and predicate hangs off, and it extends to a sales-demo or internal QA tenant later without inventing a second mechanism.
   - **A partial unique index** makes a second operator structurally impossible rather than merely discouraged:
     ```sql
     CREATE UNIQUE INDEX one_operator_tenant ON tenants(kind) WHERE kind = 'OPERATOR';
     ```
   - **`OPERATOR_TENANT_ID` config** as an independent cross-check. The index prevents *two* operators; it cannot prevent the *wrong* one. Requiring the DB row and the environment variable to name the same tenant means a mistaken `UPDATE` alone never takes effect — someone would have to make the same mistake twice, in two different systems.

   **Fail toward billing, never toward exempting.** If `OPERATOR_TENANT_ID` is unset, behave exactly as today (no operator concept at all). If it is set but disagrees with the `kind = 'OPERATOR'` row, refuse to apply any exemption and raise it loudly — treat everyone as a `CUSTOMER`. The worst outcome of that choice is the operator consuming their own quota; the worst outcome of the opposite is silently not charging a real customer.

   Add `OPERATOR_ISSUER_ID` alongside it if a future auto-issued-invoice feature lands (see ADR-028 on why auto-issue was cut).

   Setting `kind` should be admin-only — either a migration/manual `UPDATE` done once per environment, or a narrow admin endpoint. It is not something a normal tenant flow should ever touch.
2. **Quota exemption** — skip `consumeOne` when `issuer.tenant_id === config.operator.tenantId`. A narrow, explicit carve-out at the one call site, not a general "exempt" flag on `tenants` that could be set by mistake. Note what this actually means: the operator becomes **uncapped**, not "subscription invoices are free" — their other invoicing stops counting too. That is the right outcome (the operator should not be rate-limited by their own product's tiers) but the documents should still be *counted* for usage reporting even while not being *capped*.
3. **Keep it out of the subscription lifecycle** — the operator should never hold a `subscriptions` row, and the renewal/expiry queries should skip it defensively rather than rely on nobody ever creating one.
4. **Exclude from price-change announcements**, and from any future revenue/tenant reporting.
5. **Do NOT exclude it from everything.** Certificate-expiry alerts (`notificationScheduler.runAll()` → `runCertChecksForTenant`) must keep covering the operator — their certificate expiring breaks subscription invoicing for every customer, so that is the one alert they most need. This is a targeted exclusion list, not a blanket "ignore this tenant" flag.
6. Optionally surface it in the admin tenant list so it is visibly not a customer.
7. **Consider a dedicated issue point for subscription invoicing**, separate from the one used for the operator's other work. `BUSINESS` allows unlimited branches and issue points, and `POST /v1/issuers` with `sourceIssuerId` copies the existing certificate, so this costs nothing to set up. Two benefits: SRI sequential ranges stay cleanly separated between "invoices I send Comprobify customers" and "invoices for my own work", which matters for accounting; and every report above becomes a trivial filter on `issuer_id` instead of a join through `subscriptions.initial_invoice_document_id` / `payments.invoice_document_id` (the only way to tell the two apart today). Worth deciding *before* volume accumulates — sequentials cannot be retroactively split.

**Why defer:** the current workaround holds and is cheap — put the operator tenant on BUSINESS via `PATCH /v1/admin/tenants/:id/tier` (an admin override that sets `subscription_tier` and the quota cap without creating a subscription), and simply never open a subscription for it. BUSINESS is 4,000 documents/month, which covers 4,000 paying tenants plus the operator's own invoicing, so quota is not a near-term constraint. What that workaround does *not* fix is the reporting distortion — which is why this should land before, or with, #2.

**Effort:** Small for the config pointer and the quota carve-out; the rest is a handful of query predicates. The reporting exclusion is best done as part of #2 rather than retrofitted afterwards.
