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

## 2. Async Worker for SRI Submission (RabbitMQ)

**Priority: Medium — important for production reliability**

`POST /:key/send` and `GET /:key/authorize` block the HTTP request while waiting for SRI's SOAP response (typically 5–30 s, can time out). This causes long-hanging requests and poor client experience under load. Separately, the codebase already has a growing list of fire-and-forget side effects (email sends, notification creation, webhook fan-out, subscription activation hooks) that are unawaited promises with only a `.catch(console.warn)` — if the process crashes mid-flight, or the call throws, that work is silently lost with no retry. Both problems share the same fix: a durable, broker-backed queue with **Postgres as the source of truth and RabbitMQ purely as the dispatcher, never the record.**

**Architecture:**
- Postgres remains the only durable record of *what needs to happen* — a status column (reusing existing ones like `documents.status`/`email_status` where possible) written in the same transaction as the business change. RabbitMQ never originates state; it only carries "go process this" signals.
- A publisher pushes a message to RabbitMQ after the transaction commits, and only marks the row dispatched (e.g. `dispatched_at = NOW()`) on a **broker-confirmed** publish (RabbitMQ publisher confirms — not just "the call didn't throw").
- Consumers are the *only* place that does the actual work (SRI SOAP calls, sending an email, creating a notification, fanning out a webhook). No duplicate business logic in a DB-side fallback processor — that would let the two implementations drift.
- A periodic reconciliation job (same pattern as the existing `POST /v1/admin/jobs/*` cron endpoints) finds rows stuck without a dispatch confirmation past a threshold and **re-publishes** them — it never processes them itself. A RabbitMQ outage therefore degrades to reconciliation-interval latency, not lost work or failed requests.
- Consumers must be idempotent (check the entity's current status/state-machine position before acting, mirroring `assertTransition`) since a false-negative publisher confirm can cause a redelivery.
- Deploy as a single shared RabbitMQ instance (not one per system) using a dedicated vhost + credentials scoped to this API, so the same broker can later host other systems (e.g. comprobify-web) without cross-contamination.

**Phase 1 — the original blocking-request problem:**
- `PROCESSING_MODE` env var: `sync` (current default) | `async`
- New `PENDING_SEND` status: document queued for transmission
- In async mode: `POST /:key/send` → sets `PENDING_SEND`, publishes to RabbitMQ, returns 202 immediately
- RabbitMQ consumer submits to SRI → updates status (`RECEIVED`/`RETURNED`)
- A consumer also handles `RECEIVED` documents older than N minutes to check authorization (replaces the old "worker polls" approach with a delayed/scheduled message)
- State machine and DB trigger must be updated to allow `SIGNED → PENDING_SEND`
- Reconciliation job re-publishes any `PENDING_SEND` (or `RECEIVED`-awaiting-authorization) row whose dispatch was never confirmed or has gone stale

**Phase 2 — migrate existing fire-and-forget side effects onto the same mechanism**, once Phase 1's publisher/consumer/reconciliation infra exists:

| Call site | Today |
|---|---|
| `notificationService.createDocumentAuthorized` (`document-transmission.service.js`) | unawaited, `.catch(console.warn)` |
| `subscriptionService.activateIfLinked` (`document-transmission.service.js`) | unawaited, `.catch(console.warn)` |
| `subscriptionService.applyTierChangeIfLinked` (`document-transmission.service.js`) | unawaited, `.catch(console.warn)` |
| `subscriptionService.applyRenewalIfLinked` (`document-transmission.service.js`) | unawaited, `.catch(console.warn)` |
| `emailService.sendInvoiceAuthorized` (`document-transmission.service.js`) | unawaited, but already has a durable retry path via `documents.email_status` + `POST /:key/email-retry` — lowest-urgency entry in this list |
| `tenantAgreementService.generateForTenant` (`registration.service.js`) | unawaited, `.catch(console.warn)` |
| `emailService.sendVerificationEmail` (`registration.service.js`) | unawaited, logs a `VERIFICATION_EMAIL_FAILED` tenant event on failure |
| `webhookDeliveryService.fanOut` (`notification.service.js`) | unawaited, `.catch(console.warn)` — fires after every notification create/update |
| `notificationService.createPaymentReviewed` / `createSubscriptionRenewalDue` / `createSubscriptionExpired` (`subscription.service.js`) | unawaited via the shared `fireAndForget()` helper |
| `emailService.sendPaymentProofSubmitted` / `sendPaymentReviewed` / `sendSubscriptionRenewalDue` / `sendSubscriptionExpired` (`subscription.service.js`) | unawaited via the same helper |

Each of these needs a status column (new, or reusing an existing one like `documents.email_status`) to record intent before publishing, so the same publish → confirm → reconcile mechanism applies uniformly instead of each call site inventing its own fire-and-forget error handling.

**Explicitly out of scope for this item:**
- Item 3's planned `api_keys.last_used_at`/`request_count` fire-and-forget update — a single indexed `UPDATE ... WHERE id = $1` per request; routing this through a broker adds latency and complexity for no benefit.
- Item 11's planned certificate-renewal audit event — a single `tenant_events` INSERT, same reasoning.
- The admin cron batch jobs (`POST /v1/admin/jobs/notifications`, `/jobs/subscriptions`, `/jobs/quota`) — already decoupled from user-facing requests and run on their own external-cron schedule. Turning each per-tenant/per-subscription unit of work into its own queued message (for parallelism and partial-failure resilience) is a reasonable future follow-up, but is independent of Phases 1–2 and not required by them.

**Effort:** High — RabbitMQ deployment (vhost + credentials), new worker process(es)/consumers, new status/dispatch-tracking columns, migration, state machine update, reconciliation job, idempotent consumers. Phase 1 alone is substantial; Phase 2 is incremental once Phase 1's infra exists.

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

**Interaction with item 2 (RabbitMQ async worker):** once `POST /:key/send` can return `202` immediately and the actual SRI outcome is produced later by a RabbitMQ consumer, the "what happened" half of the story moves out of the request/response cycle entirely — a request-only logging middleware can no longer show the full picture for an async-processed document. The consumer process(es) from item 2 need to emit the same structured JSON log shape, tagged with a correlation id (the original `requestId`, or the document's `access_key`) that ties consumer-side log lines back to the request that queued them. Sequence this after item 2 Phase 1 lands, or design the log schema with that correlation id from the start so it isn't bolted on later.

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

## 9. Payment Gateway Integration

**Priority: Low — blocked, requires a registered legal entity. Every compliant card processor needs KYC against an entity, not an individual, so this isn't avoidable by picking a different vendor. No vendor has been selected yet — not under active consideration until the entity exists.**

The manual subscription/payment pipeline this depends on (`subscriptions`/`payments` tables, promotion-time **or standalone** tier selection via `POST /v1/subscriptions`, tenant-facing proof upload, admin review with required rejection reasons, self-billed invoice linking, recurring renewals with reminder/grace/expiry, payment-review + renewal notifications, `GET /v1/subscriptions/me` status, public `/v1/tiers` catalog) is fully built — see CLAUDE.md's "Subscription + payment pipeline" entry and ADR-017 (including its 2026-06-29 addenda) for the design. This item is now scoped to only the gateway-specific automation that bolts onto it once the company exists and a vendor is chosen:

- Card collected at whichever of `POST /v1/subscriptions` or `POST /v1/tenants/promote` actually starts the subscription (tier selection no longer only happens at promotion) — sandbox/Free stays card-free either way.
- A hosted-fields/tokenization widget (whatever the chosen vendor provides) tokenizes client-side; raw card data should never reach Comprobify's servers.
- If the chosen gateway has native recurring subscriptions, it owns the charge schedule, so for a gateway-paying tenant the manual renewal cron (`subscriptionService.processDueRenewals()`, `POST /v1/admin/jobs/subscriptions` — reminder ~7 days before `current_period_end`, then expiry ~7 days after if unpaid) becomes redundant for that tenant and should be skipped, not run in parallel with the gateway's own schedule. The gateway's webhook (mirrors `mailgun-webhook.controller.js`) would create/update `payments` rows automatically (`REPORTED`→`VERIFIED` near-instantly, no tenant upload or operator review needed, `purpose: 'RENEWAL'` same as the manual flow), then the existing `linkInvoice`/`applyRenewalIfLinked` pipeline takes over from invoice-linking onward unchanged (from the gateway's perspective — the caller is still just `linkInvoice`; if item 2 Phase 2 has landed by then, `applyRenewalIfLinked`/`applyTierChangeIfLinked`/`activateIfLinked` are invoked via a RabbitMQ consumer rather than an in-process fire-and-forget call, but the gateway integration doesn't need to know or care which). Its own migration adds whatever vendor-specific columns (subscription/customer/charge ids) turn out to be needed — `subscriptions`/`payments` don't have them yet, deliberately (see ADR-017's "no payment-gateway-specific schema until a gateway is decided").
- Failed recurring charge → `payments` row `REJECTED` (with a system-generated `rejection_reason_code` — the existing enum in `src/constants/rejection-reasons.js` may need a gateway-specific value added, e.g. `CHARGE_DECLINED`, fires the existing `PAYMENT_REJECTED` notification+email unchanged) → on no resolution, downgrade to FREE the same way `subscriptionService.expireSubscription()` already does for an unpaid manual renewal (grace period already built and defaults to 7 days, see `RENEWAL_GRACE_DAYS`) — the gateway's failed-charge webhook should call (or replicate) that same function rather than inventing a second downgrade-to-FREE path. No immediate access suspension.
- Mid-cycle tier change is now fully built on the manual pipeline (`POST /v1/subscriptions/change-tier`, `subscriptions.pending_tier`, `payments.purpose`/`target_tier` — see CLAUDE.md's "Tier changes" entry): upgrades apply immediately gated on a prorated *manual* payment; downgrades are scheduled, applied at `current_period_end` by `POST /v1/admin/jobs/subscriptions`, and now also roll the period forward for free so the renewal cycle continues at the new tier. What a gateway integration still needs to add here is purely automating the upgrade side — charging the prorated amount through the gateway instead of routing it through proof-upload/admin-review — the scheduling/proration logic itself doesn't change.
- Config: a gateway-specific private key + webhook signing secret, independent per environment, same rule as `ADMIN_SECRET`/`ENCRYPTION_KEY`. Public key (if any) is frontend-only.

---

## 10. Overage Billing (Per-Tenant Toggle + Charging)

**Priority: Low — depends on the payment gateway integration (#9)**

The monthly quota reset this item used to require now exists: `tenant_quotas` (migration 073) decouples usage tracking from `tenants` entirely — one row per tenant per period (`period_start`/`period_end`, `document_quota`, `document_count`), with its own `is_current` flag mirroring `agreements`' per-type versioning. `POST /v1/admin/jobs/quota` (`tenant-quota.service.js`'s `resetDuePeriods()`) rolls over every period whose `period_end` has passed, on its own clock — independent of `subscriptions.billing_interval` for exactly the reason this item originally called out (a YEARLY subscriber must still get quota refreshed monthly, not yearly). `document-creation.service.js`'s atomic quota gate now increments/checks against the tenant's current `tenant_quotas` row instead of `tenants.document_count`/`document_quota` (both columns dropped). See CLAUDE.md's "Document quota enforcement" entry for the full design.

What's left is exactly the overage-billing half, still blocked on the payment gateway (#9) — there is no path today that lets a tenant continue past quota and get billed the difference; exceeding `document_quota` always hard-blocks via `QuotaExceededError` (402, `document-creation.service.js`).

**What:**
1. **Per-tenant overage toggle** — add `tenants.overage_enabled` (boolean). This must be opt-in, not automatic: some tenants will want a hard cap with zero surprise charges (today's behavior — keep it as the default), others will prefer to keep issuing and pay the overage rate rather than get blocked mid-month
2. **Overage charging** — when `overage_enabled = true` and quota is exceeded, allow creation to continue, track the extra count for the cycle, and bill it as one line item (`overage_count × overagePerDocumentUsd`) through the payment gateway at cycle end — not a per-document charge; most gateways don't support micro-charging per invoice
3. Expose the toggle (e.g. `PATCH /v1/tenants/overage`) and surface current-cycle overage usage somewhere the tenant can see it before the bill arrives, so it's never a surprise

**Why defer:** pointless without a gateway to charge through.

**Effort:** Medium — a new tenant-facing endpoint, the toggle/counter, and the actual charge integration once the gateway exists.

---

## 11. Audit Certificate Changes

**Priority: Low — cheap gap, found while reviewing the billing audit-trail design**

`issuer.service.js`'s `renewCertificate` updates `issuers.encrypted_private_key`/`certificate_pem`/etc. and returns — no event is logged anywhere. Given certificates are the thing that makes a signed invoice legally valid, "when was this cert replaced and by what" should be in the audit trail, not just inferable from `updated_at`.

**What:** log a `tenant_events` row (or a new `issuer_events` table if issuer-level granularity matters more than tenant-level) on certificate upload (registration/branch creation) and renewal — fingerprint and expiry are already computed by `certificateService.parseCertificate`, just not persisted as an event.

**Effort:** Low — one event write per existing call site, no new flow.

