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
- `request_count` is a monotonic counter, not windowed — for windowed analytics use structured logs (item 5) or an APM tool
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

## 5. Structured Request Logging

**Priority: Medium — important for a B2B API where documents have legal weight**

No log aggregation is currently in place. Without it there is no way to debug a client's failed integration, investigate a SRI timeout, audit a quota dispute, or detect a compromised API key being used from an unexpected IP before the tenant notices.

**What to log (one JSON line per request):**
- `timestamp`, `method`, `path`, `statusCode`, `durationMs`
- `ip` (client IP — needed for item 11's anomaly detection and for tracing unauthenticated-route abuse, e.g. registration recovery attempts, not just for post-hoc key-leak investigation)
- `keyHash` (never the plaintext key), `apiKeyId`, `tenantId`, `issuerId` — `null` on routes that never reach `authenticate` (registration, verification, public agreement/tiers endpoints)
- `requestId` (UUID injected by middleware for correlation)

With tenant-scoped API keys, `apiKeyId` identifies the integration (e.g. `frontend-prod` vs `erp`) and `issuerId` identifies which branch the request targeted — the two dimensions slice traffic independently.

**Scope: mount globally, not just on authenticated routes.** The original draft of this item only attached fields "after `authenticate` runs," which would silently exclude every public endpoint — `POST /v1/register`, `POST /v1/recover`, `/v1/resend-verification`, `/v1/verify-email`, `GET /v1/agreements/*`, `GET /v1/tiers`. Mount the logging middleware ahead of `authenticate` at the top of the stack so every request gets a line regardless of whether it ever authenticates; the identity fields are simply `null` until `authenticate` (if it runs at all) populates `req.tenant`/`req.apiKey`.

**What this enables:**
- **Client debugging** — look up a key hash and see exactly what was sent and what the API returned, without needing the client to reproduce
- **SRI failure investigation** — the document event log captures outcomes but not timing; logs capture slow or intermittently failing SRI SOAP calls
- **Quota disputes** — per-request audit trail independent of the `document_count` counter
- **Security** — detect a leaked key used from an unexpected IP before the tenant reports it; especially important given documents have legal standing under Ecuadorian tax law
- **Traces registration recovery volume** — `path=/v1/recover` + `ip` + `timestamp` gives per-IP/per-time visibility into recovery attempts with no registration-specific code. Note the anti-enumeration design means `statusCode` alone can't distinguish a real match from a no-op (both return `200`) — item 11's anomaly detection is what actually needs to tell those apart, not this logging layer

**Implementation:**
1. Add `express-winston` (or a thin custom middleware) to emit one structured JSON log line per request after the response is sent, mounted globally (see Scope above) — attach `tenantId`/`issuerId`/`keyHash`/`apiKeyId` from `req` when `authenticate` has run, `null` otherwise
2. Ship logs to **Datadog** or **Betterstack** (both have free tiers; Betterstack integrates in ~10 lines for Node)
3. The item 3 `request_count` counter on `api_keys` still has value as a cheap "is this key alive" check without a log query — these two are complementary, not alternatives

**Note:** log the `keyHash`, never the plaintext token. All sensitive fields (`encrypted_private_key`, cert PEM, passwords) must be excluded.

**Interaction with the RabbitMQ async worker:** since `POST /:key/send`/`GET /:key/authorize` now return `202` immediately and the actual SRI outcome is produced later by `workers/worker.js`, the "what happened" half of the story lives outside the request/response cycle — a request-only logging middleware can't show the full picture for an async-processed document. `workers/worker.js` needs to emit the same structured JSON log shape, tagged with a correlation id (the original `requestId`, or the document's `access_key`) that ties consumer-side log lines back to the request that queued them.

**Effort:** Low — one middleware, one external service connection, no migrations.

---

## 6. API Key Scopes

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

## 7. Shared Rate-Limit Store for Horizontal Scaling

**Priority: Medium — blocks running more than one API instance correctly in production**

`src/middleware/rate-limit.js` uses `express-rate-limit`'s default in-memory store. Each Render instance counts requests independently, so running N instances lets a tenant burst to roughly `limit × N` before any single instance throttles them — the counters aren't shared across instances.

**What:**
- Swap the store backing `writeLimiter`/`readLimiter` to a shared one (`rate-limit-redis`, backed by a small Redis instance — Render's own Redis add-on or Upstash) so all instances enforce one counter per `keyHash`
- No change to the limiter logic or tier-based limits themselves — only the store option

**Effort:** Low — one new dependency, one Redis connection, swap the store option in `rate-limit.js`. Must land before scaling the production API to more than one instance.

---

## 8. Payment Gateway Integration

**Priority: Low — blocked, requires a registered legal entity. Every compliant card processor needs KYC against an entity, not an individual, so this isn't avoidable by picking a different vendor. No vendor has been selected yet — not under active consideration until the entity exists.**

The manual subscription/payment pipeline this depends on is already fully built — see CLAUDE.md's "Subscription + payment pipeline" entry and ADR-017 for the design. This item is scoped to only the gateway-specific automation that bolts onto it once the company exists and a vendor is chosen:

- Card collected at whichever of `POST /v1/subscriptions` or `POST /v1/tenants/promote` actually starts the subscription (tier selection no longer only happens at promotion) — sandbox/Free stays card-free either way.
- A hosted-fields/tokenization widget (whatever the chosen vendor provides) tokenizes client-side; raw card data should never reach Comprobify's servers.
- If the chosen gateway has native recurring subscriptions, it owns the charge schedule, so for a gateway-paying tenant the manual renewal cron (`subscriptionService.processDueRenewals()`, `POST /v1/admin/jobs/subscriptions` — reminder ~7 days before `current_period_end`, then expiry ~7 days after if unpaid) becomes redundant for that tenant and should be skipped, not run in parallel with the gateway's own schedule. The gateway's webhook (mirrors `mailgun-webhook.controller.js`) would create/update `payments` rows automatically (`REPORTED`→`VERIFIED` near-instantly, no tenant upload or operator review needed, `purpose: 'RENEWAL'` same as the manual flow), then the existing `linkInvoice`/`applyRenewalIfLinked` pipeline takes over from invoice-linking onward unchanged (from the gateway's perspective — the caller is still just `linkInvoice`; `applyRenewalIfLinked`/`applyTierChangeIfLinked`/`activateIfLinked` are called synchronously when the invoice is already `AUTHORIZED` at link time, or picked up by the periodic `applyPendingInvoiceLinks()` scan otherwise — see CLAUDE.md's "Async worker: pending_effects outbox" entry — but the gateway integration doesn't need to know or care which). Its own migration adds whatever vendor-specific columns (subscription/customer/charge ids) turn out to be needed — `subscriptions`/`payments` don't have them yet, deliberately (see ADR-017's "no payment-gateway-specific schema until a gateway is decided").
- Failed recurring charge → `payments` row `REJECTED` (with a system-generated `rejection_reason_code` — the existing enum in `src/constants/rejection-reasons.js` may need a gateway-specific value added, e.g. `CHARGE_DECLINED`, fires the existing `PAYMENT_REJECTED` notification+email unchanged) → on no resolution, downgrade to FREE the same way `subscriptionService.expireSubscription()` already does for an unpaid manual renewal (grace period already built and defaults to 7 days, see `RENEWAL_GRACE_DAYS`) — the gateway's failed-charge webhook should call (or replicate) that same function rather than inventing a second downgrade-to-FREE path. No immediate access suspension.
- Mid-cycle tier change is now fully built on the manual pipeline (`POST /v1/subscriptions/change-tier`, `subscriptions.pending_tier`, `payments.purpose`/`target_tier` — see CLAUDE.md's "Tier changes" entry): upgrades apply immediately gated on a prorated *manual* payment; downgrades are scheduled, applied at `current_period_end` by `POST /v1/admin/jobs/subscriptions`, and now also roll the period forward for free so the renewal cycle continues at the new tier. What a gateway integration still needs to add here is purely automating the upgrade side — charging the prorated amount through the gateway instead of routing it through proof-upload/admin-review — the scheduling/proration logic itself doesn't change.
- Config: a gateway-specific private key + webhook signing secret, independent per environment, same rule as `ADMIN_SECRET`/`ENCRYPTION_KEY`. Public key (if any) is frontend-only.

---

## 9. Overage Billing (Per-Tenant Toggle + Charging)

**Priority: Low — depends on the payment gateway integration (#8)**

The monthly-quota-reset prerequisite this item used to require is already built (`tenant_quotas`, see CLAUDE.md's "Document quota enforcement" entry). What's left is exactly the overage-billing half, still blocked on the payment gateway (#8) — there is no path today that lets a tenant continue past quota and get billed the difference; exceeding `document_quota` always hard-blocks via `QuotaExceededError` (402, `document-creation.service.js`).

**What:**
1. **Per-tenant overage toggle** — add `tenants.overage_enabled` (boolean). This must be opt-in, not automatic: some tenants will want a hard cap with zero surprise charges (today's behavior — keep it as the default), others will prefer to keep issuing and pay the overage rate rather than get blocked mid-month
2. **Overage charging** — when `overage_enabled = true` and quota is exceeded, allow creation to continue, track the extra count for the cycle, and bill it as one line item (`overage_count × overagePerDocumentUsd`) through the payment gateway at cycle end — not a per-document charge; most gateways don't support micro-charging per invoice
3. Expose the toggle (e.g. `PATCH /v1/tenants/overage`) and surface current-cycle overage usage somewhere the tenant can see it before the bill arrives, so it's never a surprise

**Why defer:** pointless without a gateway to charge through.

**Effort:** Medium — a new tenant-facing endpoint, the toggle/counter, and the actual charge integration once the gateway exists.

---

## 10. Audit Certificate Changes

**Priority: Low — cheap gap, found while reviewing the billing audit-trail design**

`issuer.service.js`'s `renewCertificate` updates `issuers.encrypted_private_key`/`certificate_pem`/etc. and returns — no event is logged anywhere. Given certificates are the thing that makes a signed invoice legally valid, "when was this cert replaced and by what" should be in the audit trail, not just inferable from `updated_at`.

**What:** log a `tenant_events` row (or a new `issuer_events` table if issuer-level granularity matters more than tenant-level) on certificate upload (registration/branch creation) and renewal — fingerprint and expiry are already computed by `certificateService.parseCertificate`, just not persisted as an event.

**Effort:** Low — one event write per existing call site, no new flow.

---

## 11. Generic Repeated-Attempt / Anomaly Detection

**Priority: Medium — reusable security mechanism, first identified while closing the registration recovery account-takeover gap**

That fix (see `CHANGELOG.md`'s Unreleased/Added entry — `POST /v1/recover`) closed the takeover itself, but left "what if someone keeps trying anyway" unaddressed. Rather than build one-off counting/alerting logic just for that endpoint, this item is a small reusable mechanism any sensitive code path can call into — because registration recovery isn't the only place a repeated-attempt pattern is worth noticing:

- **Registration recovery** (`POST /v1/recover`) — repeated recovery key issuances for the same tenant. Note this can't be counted via a distinct "mismatch" error the way it originally could — the endpoint deliberately returns the same generic response for every non-matching attempt (anti-enumeration), so the only observable signal here is the *successful* case repeating unexpectedly often, which could indicate a compromised certificate being reused rather than one being guessed
- **API key authentication** (`authenticate` middleware) — repeated bearer tokens that fail the `keyHash` lookup, which can indicate someone testing leaked/scraped keys
- **Admin authentication** (`authenticate-admin.js`) — repeated wrong `ADMIN_SECRET` values against `/v1/admin/*`, currently only bounded by `adminLimiter`'s 20 req/min IP cap with no alerting on sustained attempts
- **Mailgun webhook** (`verify-mailgun-webhook.js`) — repeated invalid HMAC signatures could indicate probing, not just a misconfigured signing key

**Important framing: this is not brute-force *prevention*.** Every secret involved (API keys, `ADMIN_SECRET`, verification tokens, cert fingerprints) is already high-entropy (256-bit or equivalent) and computationally infeasible to guess — nothing here is defending against an attacker who could plausibly succeed by trying enough values. The value is *detection*: repeated failures against the same target is a signal an operator should see, regardless of whether the underlying attack was ever likely to work.

**What:**
- A small reusable service (e.g. `src/services/attempt-tracker.service.js`) exposing something like `recordFailure(eventType, key)` → returns whether the configured threshold was crossed for that `(eventType, key)` pair within the configured window
- A pluggable action on threshold-crossed — start with a single WARN-level structured log line (once item 5 ships, this is just another queryable log line, no separate storage needed for the *detection* half); escalate later to an email via the existing `ADMIN_NOTIFICATION_EMAIL`/`emailService` pattern (mirrors `sendPaymentProofSubmitted`'s operator-facing notification) if false-positive rate proves low enough to be worth an inbox ping
- **Depends on item 7's shared store to be meaningful in production** — an in-memory counter is exactly the per-instance problem item 7 already documents for the rate limiters (`limit × N` across N instances). Either sequence this after item 7, or reuse whatever Redis connection item 7 introduces rather than standing up a second one
- First wire-up targets: the three call sites listed above — proves the mechanism generalizes before adding a fourth

**Effort:** Medium — the tracker itself is small, but real value depends on item 7 landing first, and touches three separate existing call sites to wire in.

