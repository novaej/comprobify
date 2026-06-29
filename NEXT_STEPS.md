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

## 2. Async Worker for SRI Submission

**Priority: Medium — important for production reliability**

`POST /:key/send` and `GET /:key/authorize` block the HTTP request while waiting for SRI's SOAP response (typically 5–30 s, can time out). This causes long-hanging requests and poor client experience under load.

**What:**
- `PROCESSING_MODE` env var: `sync` (current default) | `async`
- New `PENDING_SEND` status: document queued for transmission
- In async mode: `POST /:key/send` → sets `PENDING_SEND`, returns 202 immediately
- Worker polls `PENDING_SEND` documents with `SELECT ... FOR UPDATE SKIP LOCKED` → submits to SRI → updates status
- Worker also polls `RECEIVED` documents older than N minutes to check authorization
- State machine and DB trigger must be updated to allow `SIGNED → PENDING_SEND`

**Effort:** High — new worker process, new status, migration, state machine update. Pairs well with webhook notifications to push async results to clients.

---

## 3. API Key Usage Tracking

**Priority: Medium — observability for named integrations**

Rate limiting is already per `keyHash` (in-memory, enforces throttling). But there is no persistent usage record per key — request counts reset on restart and there is no way to answer "how many requests did the ERP integration make last month?" With tenant-scoped keys, this is the only way to slice traffic per integration (`frontend-prod`, `erp`, `mobile`, etc.); per-issuer slicing is already derivable from `documents.issuer_id`.

**What to track (add to `api_keys` table):**
- `last_used_at TIMESTAMPTZ` — updated on every authenticated request
- `request_count BIGINT NOT NULL DEFAULT 0` — lifetime request counter, incremented on every authenticated request

**Implementation:**
1. Migration — `ALTER TABLE api_keys ADD COLUMN last_used_at TIMESTAMPTZ, ADD COLUMN request_count BIGINT NOT NULL DEFAULT 0`
2. `authenticate` middleware — after a successful key lookup, fire a background `UPDATE api_keys SET last_used_at = NOW(), request_count = request_count + 1 WHERE id = $1` (no `await` — fire and forget, does not block the request)
3. Admin / tenant key list endpoints — expose `lastUsedAt` and `requestCount` in the response so operators can see activity per integration

**What this enables:**
- Identify dormant integrations (key never used or `last_used_at` months ago)
- Spot an integration generating unexpectedly high volume
- Revoke a compromised key with confidence that the request spike matches the revocation event
- Audit trail: `created_at` + `last_used_at` + `request_count` per key tells the full lifecycle story

**Notes:**
- `request_count` is a monotonic counter, not windowed — for windowed analytics use structured logs (item 6) or an APM tool
- The background UPDATE is a single indexed write per request (`WHERE id = $1`); acceptable overhead for the observability gain
- Per-issuer document volume is already derivable from `documents.issuer_id` — this adds the per-integration request-level dimension

**Effort:** Low — one migration, ~3 lines in the authenticate middleware, small admin response change.

---

## 4. Reporting

**Priority: Low — depends on client requirements**

Not a core API feature. Only worth building once a client explicitly needs it.

**What:**
- Revenue summaries by issuer, date range, document type
- Document counts by status
- CSV export

**Effort:** Medium — multiple query endpoints, no architectural changes needed.

---

## 5. Registration DoS Monitoring

**Priority: Low — risk mitigation**

`POST /v1/register` is now idempotent: calling it with an existing email revokes the current sandbox key and issues a new one. This is intentional for frontend recovery, but a bad actor could loop it to continuously invalidate a tenant's key.

The existing `registrationLimiter` (5 req/hour per IP) limits per-IP burst, but does not detect distributed multi-IP abuse targeting a single email.

**What:**
- Structured log entry whenever a recovery key is issued (email, IP, timestamp) — already distinguishable via the `recovered: true` flag in the service response
- Alert rule (e.g., Datadog / Grafana) firing when the same email sees >3 recovery key issuances within a rolling 1-hour window
- Optionally: add an `api_key_recovery_count` counter to `tenants` and expose it in the admin tenant detail response so operators can spot abuse manually

**Effort:** Low (logging only) to Medium (alerting infrastructure).

---

## 6. Structured Request Logging

**Priority: Medium — important for a B2B API where documents have legal weight**

No log aggregation is currently in place. Without it there is no way to debug a client's failed integration, investigate a SRI timeout, audit a quota dispute, or detect a compromised API key being used from an unexpected IP before the tenant notices.

**What to log (one JSON line per request):**
- `timestamp`, `method`, `path`, `statusCode`, `durationMs`
- `keyHash` (never the plaintext key), `apiKeyId`, `tenantId`, `issuerId`
- `requestId` (UUID injected by middleware for correlation)

With tenant-scoped API keys, `apiKeyId` identifies the integration (e.g. `frontend-prod` vs `erp`) and `issuerId` identifies which branch the request targeted — the two dimensions slice traffic independently.

**What this enables:**
- **Client debugging** — look up a key hash and see exactly what was sent and what the API returned, without needing the client to reproduce
- **SRI failure investigation** — the document event log captures outcomes but not timing; logs capture slow or intermittently failing SRI SOAP calls
- **Quota disputes** — per-request audit trail independent of the `document_count` counter
- **Security** — detect a leaked key used from an unexpected IP before the tenant reports it; especially important given documents have legal standing under Ecuadorian tax law

**Implementation:**
1. Add `express-winston` (or a thin custom middleware) to emit one structured JSON log line per request after the response is sent — attach `tenantId`, `issuerId`, `keyHash` from `req` after `authenticate` runs
2. Ship logs to **Datadog** or **Betterstack** (both have free tiers; Betterstack integrates in ~10 lines for Node)
3. The item 3 `request_count` counter on `api_keys` still has value as a cheap "is this key alive" check without a log query — these two are complementary, not alternatives

**Note:** log the `keyHash`, never the plaintext token. All sensitive fields (`encrypted_private_key`, cert PEM, passwords) must be excluded.

**Effort:** Low — one middleware, one external service connection, no migrations.

---

## 7. API Key Scopes

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

## 8. Shared Rate-Limit Store for Horizontal Scaling

**Priority: Medium — blocks running more than one API instance correctly in production**

`src/middleware/rate-limit.js` uses `express-rate-limit`'s default in-memory store. Each Render instance counts requests independently, so running N instances lets a tenant burst to roughly `limit × N` before any single instance throttles them — the counters aren't shared across instances.

**What:**
- Swap the store backing `writeLimiter`/`readLimiter` to a shared one (`rate-limit-redis`, backed by a small Redis instance — Render's own Redis add-on or Upstash) so all instances enforce one counter per `keyHash`
- No change to the limiter logic or tier-based limits themselves — only the store option

**Effort:** Low — one new dependency, one Redis connection, swap the store option in `rate-limit.js`. Must land before scaling the production API to more than one instance.

---

## 9. Subscription + Payment Pipeline (manual flow ✅ implemented; Kushki blocked)

**Priority: Low — remaining scope is Kushki-only, and that stays blocked until a legal entity exists (see below)**

**Status: implemented** (migrations `052_subscriptions_and_payments.sql` + `053_payment_proof_and_yearly_billing.sql`, `src/models/subscription.model.js` + `payment.model.js`, `src/services/subscription.service.js`, admin routes under `/v1/admin/...`, tenant-facing proof upload at `/v1/payments/:id/proof`, public catalog at `/v1/tiers`). Only the Kushki section below remains pending.

**Core design rule:** a subscription becomes `ACTIVE` only when its billing-period invoice is **SRI-authorized** — never merely on payment. `document-transmission.service.js`'s `checkAuthorization()` fires `subscriptionService.activateIfLinked(documentId)` fire-and-forget on every authorization (no-op for documents not linked to a subscription).

**Tier selection happens at promotion, not registration.** `POST /v1/tenants/promote` (tenant-facing, existing endpoint) gained optional `tier`/`billingInterval` fields. Promotion itself (sandbox flip, key rotation) always proceeds immediately regardless of whether a tier was requested — production access on FREE is never gated on payment. Requesting a paid tier just also kicks off the same `subscriptionService.createSubscription()` used by the admin-driven path.

**Schema (as built — deliberately has no payment-gateway-specific columns; nothing Kushki-shaped exists until a gateway is actually decided and built, then it gets its own dedicated migration):**
- **`subscriptions`** — `tenant_id`, `tier` (`STARTER`/`GROWTH`/`BUSINESS` only — `FREE` never needs one), `billing_interval` (`MONTHLY`/`YEARLY`, default `MONTHLY`), `status`, `invoice_document_id` (nullable FK to `documents.id`), `current_period_start`/`current_period_end` (set at activation, length depends on `billing_interval`), `created_at`, `updated_at` (+ trigger), `canceled_at`.
  - `status`: `PENDING_PAYMENT` → `PAYMENT_RECEIVED` → `INVOICE_PROCESSING` → `ACTIVE`, plus `EXPIRED`/`SUSPENDED`/`CANCELLED` in the CHECK constraint for forward-compatibility — nothing drives `EXPIRED`/`SUSPENDED` yet (no renewal job exists; that's #10). `cancelSubscription` is the only thing that sets `CANCELLED` today.
- **`payments`** — `subscription_id`, `status` (`PENDING`/`REPORTED`/`VERIFIED`/`REJECTED`/`REFUNDED` — `REFUNDED` unused so far), `amount` (computed server-side from `TIERS[tier].priceMonthlyUsd`/`priceYearlyUsd`, never client-supplied), `method` (CHECK constraint only allows `SPI_TRANSFER` today), `proof_file`/`proof_filename`/`proof_mime_type` (BYTEA, same pattern as `issuers.logo`), `rejection_reason` (set by `reviewPayment` when rejecting, required by the validator; cleared automatically on re-upload), `period_start`/`period_end` (stamped by `activateIfLinked` onto the specific payment that funded that cycle — `subscriptions.current_period_start/end` gets overwritten every renewal, so this is what makes per-cycle history reconstructable once renewals exist), `reported_at`, `verified_at`, `created_at`, `updated_at` (+ trigger).
- `tenant_events` gained: `SUBSCRIPTION_CREATED`, `PAYMENT_REPORTED`, `PAYMENT_VERIFIED`, `PAYMENT_REJECTED`, `INVOICE_LINKED`, `SUBSCRIPTION_ACTIVATED`, `SUBSCRIPTION_CANCELLED`, `TIER_CHANGED` (logged by `admin.service.js`'s `updateTenantTier` — the direct admin override now has an audit trail too). (`SUBSCRIPTION_EXPIRED`/`SUSPENDED` deliberately *not* added yet — add them alongside whatever in #10 actually triggers those transitions.)

**Pricing:** `TIERS[tier].priceYearlyUsd` = `priceMonthlyUsd × 10` (2 months free) for STARTER/GROWTH/BUSINESS. Public `GET /v1/tiers` (no auth, no rate limiter — static catalog data) exposes the full catalog for a pricing page.

**Flow (implemented):**
1. Tier requested at promotion (`POST /v1/tenants/promote`, `{ tier, billingInterval }`) or by an operator via `POST /v1/admin/tenants/:id/subscriptions` → `subscriptions` row `PENDING_PAYMENT` + `payments` row `PENDING` priced from the tier/interval. Response includes `bankTransfer` instructions (`config.bankTransfer`, `src/config/index.js` — bank name/account/holder from env vars, display text only).
2. **Tenant** uploads proof of the SPI transfer — `PATCH /v1/payments/:id/proof` (multipart, their own API key, `src/routes/payments.routes.js`; ownership-checked: payment → subscription → `tenant_id` must match). Moves the payment to `REPORTED`. Rejects only if the payment was already `VERIFIED` — a `REJECTED` payment can be re-submitted (clears `rejection_reason`, moves back to `REPORTED`), since rejection is usually something fixable (e.g. "transfer hadn't reflected yet"), not a dead end.
3. **Operator** reviews it — `GET /v1/admin/payments/:id/proof` streams the file back (mirrors the RIDE PDF `res.send(buffer)` pattern), then `PATCH /v1/admin/payments/:id/review` (`{ decision: "VERIFIED" | "REJECTED", rejectionReason }` — **one** endpoint, not separate verify/reject routes, since it's one decision with two outcomes). `rejectionReason` is required when rejecting — the tenant sees it via `GET /v1/subscriptions/me` (#12). `VERIFIED` moves the subscription to `PAYMENT_RECEIVED`.
4. Operator issues the self-billing invoice through Comprobify's own API (own RUC/issuer), then `PATCH /v1/admin/subscriptions/:id/link-invoice` (`{ accessKey }` — `documents.id` is never exposed in any response, so the 49-digit access key is the only identifier this could use) → `invoice_document_id` set, subscription → `INVOICE_PROCESSING`. If the document being linked is *already* `AUTHORIZED`, `linkInvoice` activates it immediately instead of waiting on step 5's hook, which only fires on a *new* authorization transition.
5. Once that document reaches `AUTHORIZED` → the fire-and-forget hook in `document-transmission.service.js` flips the subscription to `ACTIVE`, stamps the period on both the subscription and the funding payment, and calls `tenantModel.updateTier()` to actually grant the tier/quota.
6. `PATCH /v1/admin/subscriptions/:id/cancel` → `CANCELLED` at any point (does not auto-downgrade the tenant — no renewal/expiry logic exists yet).

**Kushki flow (blocked — requires a registered legal entity; every compliant card processor needs KYC against an entity, not an individual, so this isn't avoidable by picking a different gateway; nothing below is built and no schema for it exists yet):**
- Card collected at `POST /v1/tenants/promote` (same place tier selection already happens) — sandbox/Free stays card-free.
- Kushki.js (hosted fields) tokenizes client-side; raw card data never reaches Comprobify's servers.
- Kushki has native recurring subscriptions — it owns the charge schedule, no custom billing cron needed. Its webhook (mirrors `mailgun-webhook.controller.js`) creates/updates `payments` rows automatically (`REPORTED`→`VERIFIED` near-instantly, no tenant upload or operator review needed) instead of steps 2-3 above, then the same pipeline takes over from step 4. Its own migration adds whatever Kushki-specific columns (subscription/customer/charge ids) turn out to be needed — `subscriptions`/`payments` don't have them yet.
- Failed recurring charge → `payments` row `REJECTED`, subscription → `SUSPENDED`, notify via `notificationService`, auto-downgrade to FREE after a grace period (propose 7 days) if unresolved. No immediate access suspension.
- Mid-cycle tier change: upgrades apply immediately with a prorated charge; downgrades apply only at next renewal — no credit/refund logic needed. (Will need its own `pending_tier`-style column added at that point — not present today.)
- Config: `KUSHKI_PRIVATE_KEY` + webhook signing secret, independent per environment, same rule as `ADMIN_SECRET`/`ENCRYPTION_KEY`. Public key is frontend-only.

---

## 10. Overage Billing (Monthly Quota Reset + Per-Tenant Overage Toggle)

**Priority: Low — depends on the Kushki integration (#9) landing first**

Two things have to exist before `overagePerDocumentUsd` (`subscription-tiers.js`) means anything: a billing cycle for quota to reset against, and a gateway to actually charge through. Neither exists today. `tenants.document_count` never resets anywhere in the codebase — it's a lifetime counter, not a monthly one, despite every doc describing quotas as "documents/month." And exceeding `document_quota` always hard-blocks via `QuotaExceededError` (402, `document-creation.service.js`) — there is no path today that lets a tenant continue past quota and get billed the difference.

**What:**
1. **Monthly reset** — give quota an actual billing-period concept (e.g. a scheduled job, or a `tenants.quota_period_start` column checked at request time) that zeroes `document_count` at the start of each cycle, so "N documents/month" is true rather than aspirational
2. **Per-tenant overage toggle** — add `tenants.overage_enabled` (boolean). This must be opt-in, not automatic: some tenants will want a hard cap with zero surprise charges (today's behavior — keep it as the default), others will prefer to keep issuing and pay the overage rate rather than get blocked mid-month
3. **Overage charging** — when `overage_enabled = true` and quota is exceeded, allow creation to continue, track the extra count for the cycle, and bill it as one line item (`overage_count × overagePerDocumentUsd`) through the payment gateway at cycle end — not a per-document charge; most gateways don't support micro-charging per invoice
4. Expose the toggle (e.g. `PATCH /v1/tenants/overage`) and surface current-cycle overage usage somewhere the tenant can see it before the bill arrives, so it's never a surprise

**Why defer:** pointless without a gateway to charge through, and the monthly reset is a prerequisite most of this depends on regardless of billing.

**Effort:** Medium-High — migration for the reset/toggle/counter, a scheduled job for the reset, a new tenant-facing endpoint, and the actual charge integration once the gateway exists.

---

## 11. Audit Certificate Changes

**Priority: Low — cheap gap, found while reviewing the billing audit-trail design**

`issuer.service.js`'s `renewCertificate` updates `issuers.encrypted_private_key`/`certificate_pem`/etc. and returns — no event is logged anywhere. Given certificates are the thing that makes a signed invoice legally valid, "when was this cert replaced and by what" should be in the audit trail, not just inferable from `updated_at`.

**What:** log a `tenant_events` row (or a new `issuer_events` table if issuer-level granularity matters more than tenant-level) on certificate upload (registration/branch creation) and renewal — fingerprint and expiry are already computed by `certificateService.parseCertificate`, just not persisted as an event.

**Effort:** Low — one event write per existing call site, no new flow.

---

## 12. Tenant-Facing Subscription/Payment Status Endpoint ✅ Implemented

**Status: implemented.** `GET /v1/subscriptions/me` (tenant-facing, `src/controllers/subscription.controller.js` + `src/routes/subscriptions.routes.js`) returns the tenant's full subscription history, newest first, each with its `payments` nested (`proof_file` stripped, same `omitProofFile` helper used everywhere else). This is the in-between-state visibility `GET /v1/tenants/me` alone never gave — including `rejection_reason` when a payment was rejected, so a tenant knows what to fix before re-uploading.

Also fixed alongside this: `payments` gained a `rejection_reason` column (migration `054_payment_rejection_reason.sql`). `PATCH /v1/admin/payments/:id/review` now **requires** `rejectionReason` when `decision` is `REJECTED` (validator-enforced) — a rejection with no reason isn't actionable for the tenant. `submitPaymentProof` was also corrected: it originally blocked re-uploading proof once a payment was `VERIFIED` *or* `REJECTED`, which made rejection a dead end (e.g. "transfer not reflected yet" should be fixable by re-uploading once it clears, not require a brand-new payment). It now only blocks on `VERIFIED`; re-submitting after `REJECTED` clears the old `rejection_reason` and moves back to `REPORTED`.
