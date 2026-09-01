# ADR-029: Genuinely Unlimited ENTERPRISE Quota, and Pooled Annual Quota for YEARLY Subscribers

## Status
Accepted

## Date
2026-08-31

## Context

Two related but independent gaps in `tenant_quotas` (migration 073):

**1. ENTERPRISE wasn't actually unlimited.** `TIERS.ENTERPRISE.documentQuota` was `100000` — a large sentinel, not `null` the way `maxBranches`/`maxIssuePointsPerBranch` already express "unlimited" elsewhere in the same file. The sentinel existed only because `tenant_quotas.document_quota` was `NOT NULL` and the atomic quota gate (`incrementIfWithinCap`) compared `document_count < document_quota` directly — a real `NULL`-as-unlimited needed a schema change, which nobody had done yet.

**2. A YEARLY subscriber's quota reset on the same 30-day clock as a MONTHLY subscriber's.** `documentQuota` in `subscription-tiers.js` is a per-month figure, and `tenant_quotas.period_start`/`period_end` rolled over monthly regardless of `subscriptions.billing_interval` — a deliberate decision at the time (see the old CLAUDE.md text this ADR replaces) to stop a yearly payer's usage counter from only refreshing once a year. But the fix over-corrected: a tenant who paid once for 12 months of service still only ever got one month's worth of documents at a time, with nothing carried over — the exact opposite of what "paid for the year" implies. A tier with `documentQuota: 40` should let a YEARLY subscriber issue 0 documents in January and 480 in December if that's how their year goes, not hard-block them at 40 every single month.

## Decision

**ENTERPRISE: `documentQuota: null` is real, schema-enforced unlimited.**

`tenant_quotas.document_quota` becomes nullable (migration 094). `incrementIfWithinCap`'s gate becomes `document_quota IS NULL OR document_count < document_quota` — a `NULL` cap never blocks, and `document_count` keeps incrementing anyway for visibility/reporting. Every function that resolves a tier's cap (`tenant-quota.service.js`'s `capForTier`, and the equivalent inline computation in `admin.service.js`'s `createTenant`) was changed from `TIERS[tier]?.documentQuota ?? TIERS.FREE.documentQuota` to `(TIERS[tier] || TIERS.FREE).documentQuota` — the `??` form silently collapsed ENTERPRISE's legitimate `null` back down to FREE's `5`, since `??` treats `null` and `undefined` identically. The fallback-to-FREE is only supposed to catch an unrecognized tier string, never a real tier's intentionally-null cap. This was a live bug in the *old* code, caught while implementing this ADR, not something introduced by it.

**YEARLY subscribers get a pooled annual quota, not a flat monthly one.**

`tenant_quotas` gains a `billing_interval` column (`MONTHLY`/`YEARLY`, migration 094, defaulting `MONTHLY` for every pre-existing row). For a YEARLY period, `document_quota = documentQuota × 12` and the period itself spans 12 months instead of 1 — the annual entitlement is visible and consumable however unevenly the tenant wants, for the whole year, in one row.

Two tiers were considered:

- **(a) One pooled period per year**, sized `documentQuota × 12` — what was built.
- **(b) Monthly periods that persist, with unused quota rolling forward** as an accumulating credit.

(a) was chosen: it directly matches "documentQuota × 12 available across the year," requires no new "rollover credit" concept alongside the existing cap/count columns, and degrades to exactly today's MONTHLY behavior when `billing_interval` is `MONTHLY` (multiplier of 1). (b) achieves a similar end state but needs extra bookkeeping (an accumulating credit balance, decisions about whether credit expires) to reach the same place, for a tenant experience that's observably identical to (a) in the case that actually motivated this ADR (an annual pool, consumed however the tenant likes across the year).

**Mechanics:**

- `billing_interval` lives on `tenant_quotas` itself, not re-derived by joining `subscriptions` at read time. A still-`ACTIVE` subscription's *current* `billing_interval` could disagree with what a `tenant_quotas` row was sized for if a tenant changed interval mid-cycle — storing it on the quota row and keeping it in sync explicitly (every `tenantQuotaService.setCap()` call writes it) avoids that drift entirely, and keeps `resetDuePeriods()` (the daily cron rollover) a single self-contained query with no join.
- `tenantQuotaService.setCap(tenantId, tier, billingInterval)` — extended from a cap-only update to a cap **and** `billing_interval` **and** `period_end` update, done together. It resizes `period_end` immediately (recomputed from the period's own unmoved `period_start`), so a tenant who just started a YEARLY subscription gets the full annual pool the moment their payment applies, not after waiting for the next `resetDuePeriods` sweep to notice. `document_count` and `period_start` are never touched — already-consumed documents this cycle still count against whatever the new cap is, in either direction (upgrading, downgrading, or switching interval).
- **`period_end` is computed in JS, via the existing `addMonths()` helper — never as raw SQL date arithmetic.** This was caught during implementation: `period_start + interval 'N months'` in Postgres has the *exact* same month-end overflow behavior a bare JS `Date.setMonth()` does (Jan 31 + 1 month silently becomes Mar 3), which is precisely the bug class `addMonths()` was written to prevent for subscription billing periods (CLAUDE.md Common Mistake #26). Reusing the same helper for quota periods, rather than reimplementing the clamp in SQL, keeps one single source of truth for "add N months correctly" instead of two that can drift apart.
- Two guards in `capForTier`/`periodMonthsForTier`: ENTERPRISE's `null` cap short-circuits before any × 12 multiplier is applied (unlimited stays unlimited regardless of interval), and FREE never pools annually even if a stale `YEARLY` interval is passed through a downgrade-to-FREE call site (there's no live YEARLY+FREE subscription in practice — `createSubscription` rejects FREE outright — but the guard is defensive rather than relying on that always holding). `setCap()` also normalizes what it *persists*: it stores the interval that was actually applied (`YEARLY` only if the × 12 multiplier actually fired), not the raw input, so `tenant_quotas.billing_interval` never claims a pool that wasn't actually granted.

**Mid-year tier changes:** unchanged in shape from before this ADR — `setCap()` was already called at every point a tenant's tier changes (upgrade, downgrade, refund rollback, expiry-to-FREE, scheduled tier-change application). Extending it to also carry `billingInterval` means a same-interval tier change (the common case) just resizes the cap while keeping the same pooling mode, and a billing-interval change (always deferred to `current_period_end` per the existing tier-change design, immediate only in sandbox) resizes both the cap and the pool shape at the moment it actually applies.

**Promotion (`resetPeriodOnPromotion`):** untouched. It only ever reset the *subscription's* `current_period_start`/`current_period_end`, never `tenant_quotas` — quota periods have always run on their own independent clock, seeded once at signup/admin-creation and rolled forward only by `resetDuePeriods()` or a `setCap()` call. This ADR doesn't add any new coupling between the two.

## Consequences

- A tenant who switches billing interval mid-cycle gets an immediately-resized cap and period boundary, but the *next* scheduled `resetDuePeriods()` rollover is what fully re-aligns the period's length going forward — there can be up to one quota-period's worth of drift between "the subscription's own billing period" and "the quota period's boundary" in the interim. This mirrors the pre-existing, already-accepted tolerance for `tenant_quotas` running on an independent clock from `subscriptions` (see CLAUDE.md's original "Document quota enforcement" text) — not a new risk this ADR introduces, just carried into the interval dimension too.
- `admin.service.js`'s `createTenant`/`updateTenantTier` admin overrides have no billing-interval context (there's no subscription at admin-tenant-creation time), so they always operate in `MONTHLY` mode. An admin who wants a newly-created tenant on a pooled annual quota needs to start a real YEARLY subscription afterward, same as any self-service tenant would.
- `comprobify-web`'s TypeScript types (`documentQuota: number`) and count-based i18n interpolation (`t('features.quota', { count: tier.documentQuota })`) assume a non-null number — they need a null-check for ENTERPRISE's unlimited display before this ships to that frontend. Flagged, not fixed here (separate repo).
