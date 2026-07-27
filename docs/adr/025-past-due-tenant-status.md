# ADR-025: PAST_DUE Tenant Status, Distinct from SUSPENDED

## Status
Accepted

## Date
2026-07-27

## Context

`CLAUDE.md`'s "Recurring renewals" entry documents the existing renewal cycle: a reminder fires 7 days before `current_period_end`, and 7 days past it with nothing paid, `subscriptionService.expireSubscription()` downgrades the tenant to FREE and marks the subscription `EXPIRED` — but never touches `tenants.status`. The tenant stays `ACTIVE` and keeps using the Service on the FREE tier indefinitely. NEXT_STEPS.md item 11 tracked closing this gap, scoped originally as "also flip `tenants.status = 'SUSPENDED'`, reusing the mechanism `admin.service.js`'s `updateTenantStatus` already has for fraud/manual suspension."

Working through the implementation surfaced a real problem with that plan: `SUSPENDED` today is exclusively admin-lifted — `require-not-suspended.js` blocks every write uniformly regardless of *why* a tenant is suspended, and there is no self-service path back to `ACTIVE`. Reusing it for non-payment would mean a tenant who simply missed a renewal has no way to pay their way back in except contacting support — a materially worse outcome than the bug being fixed, and a real product/support burden at any scale.

## Decision

**`PAST_DUE` is a new, separate `tenants.status` value — not a reuse of `SUSPENDED`.**

- `SUSPENDED` is unchanged in every respect: still exclusively admin-lifted (fraud, ToS violation, voluntary closure per `docs/agreements/terms-of-service.md` §10), still blocks everything `require-not-suspended.js` already blocks, no self-service recovery.
- `PAST_DUE` is purely an automated billing-state signal, assigned by `subscriptionService.expireSubscription()` when a renewal grace period lapses, and **self-resolving** — a `PAST_DUE` tenant can pay their way back to `ACTIVE` without any admin involvement.

Each status gets its own single-purpose middleware — `require-not-suspended.js` (unchanged) and the new `require-past-due.js`, structurally identical but checking a different status and a different error code (`ACCOUNT_PAST_DUE`, not `ACCOUNT_SUSPENDED`). Both are mounted at the same broad set of write routes every existing `requireNotSuspended` call site already has — `PAST_DUE` blocks the same surface `SUSPENDED` does — **except** two specific routes are deliberately exempted from `requireNotPastDue` alone (still gated by `requireNotSuspended`):

- `POST /v1/subscriptions` — starting a fresh subscription is the actual recovery mechanism.
- `PATCH /v1/payments/:id/proof` — submitting proof (for the new subscription's payment, or the still-open renewal payment from the original one) is the other half of it.

A `SUSPENDED` tenant gets no exception on either route — the two middlewares are independent, not a shared reason-check on one status.

**Recovery is "start a brand-new subscription," not "resurrect the expired one."** The old subscription is already `EXPIRED` — a terminal status excluded from "in-flight" by `subscriptionModel.findActiveOrPendingByTenantId` (CLAUDE.md Common Mistake #31's `CANCELLED`/`EXPIRED` exclusion) — so `createSubscriptionForTenant`'s existing in-flight check already treats a `PAST_DUE` tenant as free to start again with zero special-casing. The only change needed there is narrowing its status gate from `!== ACTIVE` (which used to reject anything non-`ACTIVE`, with a message specifically about email verification) to `=== PENDING_VERIFICATION` only — `PAST_DUE` now falls through and is allowed; `SUSPENDED` never reaches this code at all, since `requireNotSuspended` already blocks the route upstream.

`activateIfLinked` (fires when that fresh subscription's first invoice authorizes — the existing `INVOICE_PROCESSING` → `ACTIVE` transition, unchanged) gains one new step at the end: if the tenant is currently `PAST_DUE`, flip them to `ACTIVE` and log a `STATUS_CHANGED` tenant event (`reason: 'payment_recovered'`). No new tenant-event type needed — `STATUS_CHANGED` (migration 070) already covers arbitrary status transitions with a reason, same column used for the `PAST_DUE` assignment itself (`reason: 'unpaid_renewal'`).

**A second warning notification, distinct from the existing renewal-due reminder.** `subscriptionModel.findDueForSuspensionWarning(warningDays, graceDays)` fires partway through the existing grace window (`SUSPENSION_WARNING_DAYS = 5`, must stay `< RENEWAL_GRACE_DAYS = 7`) — a new `SUBSCRIPTION_PAST_DUE_WARNING` notification type (named for the new terminology, not "suspension"), following the exact same catalog/dispatch/template machinery ADR-024 already built for `SUBSCRIPTION_RENEWAL_DUE`/`SUBSCRIPTION_EXPIRED`. Its idempotency dedup follows ADR-023's "check `notifications` directly" precedent rather than a new `subscriptions` column: `NOT EXISTS (... WHERE type='SUBSCRIPTION_PAST_DUE_WARNING' AND (metadata->>'subscriptionId')::uuid = s.id AND created_at >= s.current_period_end)` — scoping to `created_at >= s.current_period_end` naturally resets every renewal cycle (a completed renewal moves `current_period_end` forward via `addBillingPeriod`, invalidating any prior cycle's warning as a match) without storing the period-end value redundantly.

The warning stage is folded directly into `processDueRenewals()` (between the existing reminder and expiry loops) rather than a new job or effect type — since ADR-024, `notificationService.createX()` + `dispatchNotification()` already handles webhook fan-out and (for email-capable types) the generic `NOTIFICATION_DISPATCH` effect for any `NotificationTypes` value with zero per-type code in `src/effects/index.js`. `admin.controller.js`'s `runSubscriptionJobs` (`POST /v1/admin/jobs/subscriptions`) needs zero changes and inherits the existing after-`applyScheduledTierChanges` ordering (Common Mistake #27) for free.

## Consequences

### Positive
- A non-payment lapse now has a real, automated consequence (matching the ToS suspension clause) with a genuine self-service recovery path — no support ticket required for the common case.
- `SUSPENDED` stays semantically pure — "an admin decided this," full stop — rather than growing a reason-dependent behavior branch that would need auditing every time someone touches suspension logic.
- The warning notification reused 100% of ADR-024's machinery (catalog entry, `dispatchNotification`, `NOTIFICATION_DISPATCH`, DB-backed template) — no new effect type, no new job, no new cron entry.

### Negative
- A fourth `tenants.status` value is one more state to reason about at every `tenant.status === ACTIVE` gate scattered through the codebase (`issuer.controller.js`, `tenant.service.js`, `api-key.service.js`, `subscription.service.js`'s own `promote()`) — this ADR only touches the one gate that needed to change (`createSubscriptionForTenant`); every other `ACTIVE`-only gate deliberately still rejects `PAST_DUE` (a past-due tenant can pay their way back in, but can't promote to production, create branches, or mint new named keys while past due — same restriction they'd have under any other non-`ACTIVE` status).
- Two middlewares now run on most write routes instead of one, and a reviewer adding a new authenticated route must remember to mount both (or make a deliberate, documented decision to omit one, as `POST /v1/subscriptions`/`PATCH /v1/payments/:id/proof` do) — mirrors the existing `requireNotSuspended`-per-router judgment call CLAUDE.md's Common Mistake #30 already calls out, just doubled.
- `notification_email_templates` (migration 079) carries its own independent `chk_notification_email_templates_type` CHECK constraint, separate from `notifications`'/`notification_preferences`' — easy to miss when adding a new email-capable notification type (this migration initially missed it; caught by the live smoke test, not the unit suite, since nothing in the mocked test path touches the real constraint).

### Alternatives Considered
- **Reuse `SUSPENDED`, gate the two recovery routes on `reason === 'unpaid_renewal'`.** The original approach floated before this ADR — rejected because it overloads one status with two different recovery semantics (admin-only vs. self-service) distinguished only by a free-text-adjacent reason field, and because it means `require-not-suspended.js` — used by every router in the codebase as "the" suspension check — would need to start being reason-aware everywhere, not just the two routes that actually need the exception.
- **A fully generic reactivation path** (resurrect the `EXPIRED` subscription via the stale renewal payment, rather than requiring a fresh `POST /v1/subscriptions`). Rejected as unnecessary complexity — `EXPIRED` is already correctly excluded from "in-flight" by the existing subscription-creation check, so "start fresh" falls out of code that already exists, with no new resurrection logic needed.
