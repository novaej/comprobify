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

**If a voiding/cancellation endpoint is ever added** (not currently planned as part of this item — SRI document types are additive, not a cancel flow), add `documents:void` to `src/constants/api-key-scopes.js`'s `ApiKeyScopes`/`ALL_SCOPES` and to migration `084_api_key_scopes.sql`'s `CHECK` constraint (new migration) in the same PR — see CLAUDE.md's "Tenant-scoped API key permissions" entry.

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

**Priority: Low — blocked, requires a registered legal entity. Every compliant card processor needs KYC against an entity, not an individual, so this isn't avoidable by picking a different vendor. No vendor has been selected yet — not under active consideration until the entity exists.**

The manual subscription/payment pipeline this depends on is already fully built — see CLAUDE.md's "Subscription + payment pipeline" entry and ADR-017 for the design. This item is scoped to only the gateway-specific automation that bolts onto it once the company exists and a vendor is chosen:

- Card collected at whichever of `POST /v1/subscriptions` or `POST /v1/tenants/promote` actually starts the subscription (tier selection no longer only happens at promotion) — sandbox/Free stays card-free either way.
- A hosted-fields/tokenization widget (whatever the chosen vendor provides) tokenizes client-side; raw card data should never reach Comprobify's servers.
- If the chosen gateway has native recurring subscriptions, it owns the charge schedule, so for a gateway-paying tenant the manual renewal cron (`subscriptionService.processDueRenewals()`, `POST /v1/admin/jobs/subscriptions` — reminder ~7 days before `current_period_end`, then expiry ~7 days after if unpaid) becomes redundant for that tenant and should be skipped, not run in parallel with the gateway's own schedule. The gateway's webhook (mirrors `mailgun-webhook.controller.js`) would create/update `payments` rows automatically (`REPORTED`→`VERIFIED` near-instantly, no tenant upload or operator review needed, `purpose: 'RENEWAL'` same as the manual flow), then `subscriptionService.applyVerifiedPayment()` applies it exactly as it does for a manual transfer — the gateway integration needs no knowledge of activation at all, and since ADR-027 nothing downstream waits on the invoice. It should also add the resulting payment to the operator invoicing queue automatically (it already will: the queue is just `VERIFIED` + `invoiced_at IS NULL`), and this is where the operator nudge email deliberately deferred in ADR-027 belongs, since no human reviews a gateway charge. Its own migration adds whatever vendor-specific columns (subscription/customer/charge ids) turn out to be needed — `subscriptions`/`payments` don't have them yet, deliberately (see ADR-017's "no payment-gateway-specific schema until a gateway is decided").
- Failed recurring charge → `payments` row `REJECTED` (with a system-generated `rejection_reason_code` — the existing enum in `src/constants/rejection-reasons.js` may need a gateway-specific value added, e.g. `CHARGE_DECLINED`, fires the existing `PAYMENT_REJECTED` notification+email unchanged) → on no resolution, downgrade the same way `subscriptionService.expireSubscription()` already does for an unpaid manual renewal (note: a *reversed* charge is a different case with its own endpoint — `PATCH /v1/admin/payments/:id/refund`, which restores `payments.applied_from` rather than dropping to FREE; see ADR-027) (grace period already built and defaults to 7 days, see `RENEWAL_GRACE_DAYS`) — the gateway's failed-charge webhook should call (or replicate) that same function rather than inventing a second downgrade-to-FREE path. No immediate access suspension.
- Mid-cycle tier change is now fully built on the manual pipeline (`POST /v1/subscriptions/change-tier`, `subscriptions.pending_tier`, `payments.purpose`/`target_tier` — see CLAUDE.md's "Tier changes" entry): upgrades apply immediately gated on a prorated *manual* payment; downgrades are scheduled, applied at `current_period_end` by `POST /v1/admin/jobs/subscriptions`, and now also roll the period forward for free so the renewal cycle continues at the new tier. What a gateway integration still needs to add here is purely automating the upgrade side — charging the prorated amount through the gateway instead of routing it through proof-upload/admin-review — the scheduling/proration logic itself doesn't change.
- Config: a gateway-specific private key + webhook signing secret, independent per environment, same rule as `ADMIN_SECRET`/`ENCRYPTION_KEY`. Public key (if any) is frontend-only.

---

## 4. Overage Billing (Per-Tenant Toggle + Charging)

**Priority: Low — depends on the payment gateway integration (#3)**

The monthly-quota-reset prerequisite this item used to require is already built (`tenant_quotas`, see CLAUDE.md's "Document quota enforcement" entry). What's left is exactly the overage-billing half, still blocked on the payment gateway (#3) — there is no path today that lets a tenant continue past quota and get billed the difference; exceeding `document_quota` always hard-blocks via `QuotaExceededError` (402, `document-creation.service.js`).

**What:**
1. **Per-tenant overage toggle** — add `tenants.overage_enabled` (boolean). This must be opt-in, not automatic: some tenants will want a hard cap with zero surprise charges (today's behavior — keep it as the default), others will prefer to keep issuing and pay the overage rate rather than get blocked mid-month
2. **Overage charging** — when `overage_enabled = true` and quota is exceeded, allow creation to continue, track the extra count for the cycle, and bill it as one line item (`overage_count × overagePerDocumentUsd`) through the payment gateway at cycle end — not a per-document charge; most gateways don't support micro-charging per invoice
3. Expose the toggle (e.g. `PATCH /v1/tenants/overage`) and surface current-cycle overage usage somewhere the tenant can see it before the bill arrives, so it's never a surprise

**Why defer:** pointless without a gateway to charge through.

**Effort:** Medium — a new tenant-facing endpoint, the toggle/counter, and the actual charge integration once the gateway exists.


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
