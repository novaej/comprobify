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
- Document counts by status
- CSV export

**Effort:** Medium — multiple query endpoints, no architectural changes needed.

---

## 3. API Key Scopes

**Priority: Low — defer until first concrete use case**

Today every API key can do everything its tenant can do. Scopes would let tenants mint a read-only key (e.g. for a dashboard pulling stats) without the ability to issue or void documents.

**Proposed scope vocabulary:**
- `documents:write` — create, send, rebuild, authorize, email-retry
- `documents:read` — list, get, ride, xml, events, stats
- `documents:void` — voiding endpoints (when added)
- `issuers:manage` — promote, create branch, document-type management

**Implementation outline:**
1. Migration — `ALTER TABLE api_keys ADD COLUMN scopes TEXT[] NOT NULL DEFAULT ARRAY['documents:write','documents:read','issuers:manage']` (full-access default preserves current behaviour)
2. Tenant key-creation endpoint accepts a `scopes` array, validated against the vocabulary
3. New `requireScope('documents:read')` middleware factory; mounted per-route alongside `authenticate` / `resolveIssuer`
4. Surface scopes in `GET /v1/keys` so operators can audit each integration's blast radius

**Why defer:** there is no client today asking for a read-only key. Adding scopes preemptively means writing validation, tests, and docs for code paths nobody is using. Revisit when the first dashboard / read-only consumer appears, or when a security review demands principle-of-least-privilege.

**Effort:** Low–Medium when the use case arrives — migration + one middleware factory + 4–8 route annotations + tests.

---

## 4. Payment Gateway Integration

**Priority: Low — blocked, requires a registered legal entity. Every compliant card processor needs KYC against an entity, not an individual, so this isn't avoidable by picking a different vendor. No vendor has been selected yet — not under active consideration until the entity exists.**

The manual subscription/payment pipeline this depends on is already fully built — see CLAUDE.md's "Subscription + payment pipeline" entry and ADR-017 for the design. This item is scoped to only the gateway-specific automation that bolts onto it once the company exists and a vendor is chosen:

- Card collected at whichever of `POST /v1/subscriptions` or `POST /v1/tenants/promote` actually starts the subscription (tier selection no longer only happens at promotion) — sandbox/Free stays card-free either way.
- A hosted-fields/tokenization widget (whatever the chosen vendor provides) tokenizes client-side; raw card data should never reach Comprobify's servers.
- If the chosen gateway has native recurring subscriptions, it owns the charge schedule, so for a gateway-paying tenant the manual renewal cron (`subscriptionService.processDueRenewals()`, `POST /v1/admin/jobs/subscriptions` — reminder ~7 days before `current_period_end`, then expiry ~7 days after if unpaid) becomes redundant for that tenant and should be skipped, not run in parallel with the gateway's own schedule. The gateway's webhook (mirrors `mailgun-webhook.controller.js`) would create/update `payments` rows automatically (`REPORTED`→`VERIFIED` near-instantly, no tenant upload or operator review needed, `purpose: 'RENEWAL'` same as the manual flow), then the existing `linkInvoice`/`applyRenewalIfLinked` pipeline takes over from invoice-linking onward unchanged (from the gateway's perspective — the caller is still just `linkInvoice`; `applyRenewalIfLinked`/`applyTierChangeIfLinked`/`activateIfLinked` are called synchronously when the invoice is already `AUTHORIZED` at link time, or picked up by the periodic `applyPendingInvoiceLinks()` scan otherwise — see CLAUDE.md's "Async worker: pending_effects outbox" entry — but the gateway integration doesn't need to know or care which). Its own migration adds whatever vendor-specific columns (subscription/customer/charge ids) turn out to be needed — `subscriptions`/`payments` don't have them yet, deliberately (see ADR-017's "no payment-gateway-specific schema until a gateway is decided").
- Failed recurring charge → `payments` row `REJECTED` (with a system-generated `rejection_reason_code` — the existing enum in `src/constants/rejection-reasons.js` may need a gateway-specific value added, e.g. `CHARGE_DECLINED`, fires the existing `PAYMENT_REJECTED` notification+email unchanged) → on no resolution, downgrade to FREE the same way `subscriptionService.expireSubscription()` already does for an unpaid manual renewal (grace period already built and defaults to 7 days, see `RENEWAL_GRACE_DAYS`) — the gateway's failed-charge webhook should call (or replicate) that same function rather than inventing a second downgrade-to-FREE path. No immediate access suspension.
- Mid-cycle tier change is now fully built on the manual pipeline (`POST /v1/subscriptions/change-tier`, `subscriptions.pending_tier`, `payments.purpose`/`target_tier` — see CLAUDE.md's "Tier changes" entry): upgrades apply immediately gated on a prorated *manual* payment; downgrades are scheduled, applied at `current_period_end` by `POST /v1/admin/jobs/subscriptions`, and now also roll the period forward for free so the renewal cycle continues at the new tier. What a gateway integration still needs to add here is purely automating the upgrade side — charging the prorated amount through the gateway instead of routing it through proof-upload/admin-review — the scheduling/proration logic itself doesn't change.
- Config: a gateway-specific private key + webhook signing secret, independent per environment, same rule as `ADMIN_SECRET`/`ENCRYPTION_KEY`. Public key (if any) is frontend-only.

---

## 5. Overage Billing (Per-Tenant Toggle + Charging)

**Priority: Low — depends on the payment gateway integration (#4)**

The monthly-quota-reset prerequisite this item used to require is already built (`tenant_quotas`, see CLAUDE.md's "Document quota enforcement" entry). What's left is exactly the overage-billing half, still blocked on the payment gateway (#4) — there is no path today that lets a tenant continue past quota and get billed the difference; exceeding `document_quota` always hard-blocks via `QuotaExceededError` (402, `document-creation.service.js`).

**What:**
1. **Per-tenant overage toggle** — add `tenants.overage_enabled` (boolean). This must be opt-in, not automatic: some tenants will want a hard cap with zero surprise charges (today's behavior — keep it as the default), others will prefer to keep issuing and pay the overage rate rather than get blocked mid-month
2. **Overage charging** — when `overage_enabled = true` and quota is exceeded, allow creation to continue, track the extra count for the cycle, and bill it as one line item (`overage_count × overagePerDocumentUsd`) through the payment gateway at cycle end — not a per-document charge; most gateways don't support micro-charging per invoice
3. Expose the toggle (e.g. `PATCH /v1/tenants/overage`) and surface current-cycle overage usage somewhere the tenant can see it before the bill arrives, so it's never a surprise

**Why defer:** pointless without a gateway to charge through.

**Effort:** Medium — a new tenant-facing endpoint, the toggle/counter, and the actual charge integration once the gateway exists.

---

## 6. Audit Certificate Changes

**Priority: Low — cheap gap, found while reviewing the billing audit-trail design**

`issuer.service.js`'s `renewCertificate` updates `issuers.encrypted_private_key`/`certificate_pem`/etc. and returns — no event is logged anywhere. Given certificates are the thing that makes a signed invoice legally valid, "when was this cert replaced and by what" should be in the audit trail, not just inferable from `updated_at`.

**What:** log a `tenant_events` row (or a new `issuer_events` table if issuer-level granularity matters more than tenant-level) on certificate upload (registration/branch creation) and renewal — fingerprint and expiry are already computed by `certificateService.parseCertificate`, just not persisted as an event.

**Effort:** Low — one event write per existing call site, no new flow.

