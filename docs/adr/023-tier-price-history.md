# ADR-023: Tier Price History with a 30-Day Change Notice

## Status
Accepted

## Date
2026-07-25

## Context

`docs/agreements/terms-of-service.md` commits to a specific contract around subscription pricing: a price change gets at least 30 days' notice by email, a renewal that falls inside that window is still billed at the old price (the new price only applies from the first renewal on or after the 30 days), and a mid-window plan upgrade is prorated against the old price too. None of this existed in the code — `TIERS[tier].priceMonthlyUsd`/`priceYearlyUsd` in `src/constants/subscription-tiers.js` were plain hardcoded numbers with no history. Changing one would reprice every tenant's very next renewal, including one due tomorrow, with zero notification of any kind. This ADR covers the design that closes that gap.

## Decision

### Only prices move to the database

A new `tier_prices` table (migration 076) becomes the sole source of truth for `priceMonthlyUsd`/`priceYearlyUsd`; both keys are removed from the `TIERS` constant entirely (no fallback, so nothing can silently read a stale value). Everything else on a tier — `documentQuota`, `maxBranches`, `maxIssuePointsPerBranch`, rate limits, `allowedDocumentTypes`, `overagePerDocumentUsd` — stays in `subscription-tiers.js` unchanged. Those fields don't need historical resolution or a notice period; they simply take effect whenever an admin changes the constant and redeploys, same as before. Moving the whole `TIERS` object to the database was considered and rejected: it would have meant admin CRUD, validation, and migration work for fields that have never needed history, in service of a "one place for tier config" symmetry the ToS clause doesn't actually require.

### `IVA_RATE` stays untouched

Ecuador's IVA rate (`config.ivaRate`, re-exported as `IVA_RATE`) is deliberately excluded from this mechanism. It's a government-mandated tax rate, not a Comprobify pricing decision — when SRI changes it, compliance is immediate, not something Comprobify can delay 30 days to "give notice" on. Every payment already snapshots the rate in effect at creation (`payments.iva_rate`, `payments.iva_amount`) for a complete per-payment audit trail, which was judged sufficient without adding a second historical table for a value that changes for reasons entirely outside product control.

### Draft → publish, resolved by date, no promotion job

A `tier_prices` row starts as `DRAFT` (admin-editable, invisible to tenants, no notice clock running) and becomes `PUBLISHED` via a confirm step (`POST /v1/admin/prices/:id/publish`) that stamps `effective_at = now + noticeDays` (floor enforced by `config.priceChangeMinNoticeDays`, default 30) and `published_at = now`. Once published, a row is immutable — the same pattern `agreements` already uses for legal document versions.

"The current price for tier X as of date D" is always `SELECT price_usd FROM tier_prices WHERE tier=X AND billing_interval=Y AND status='PUBLISHED' AND effective_at <= D ORDER BY effective_at DESC LIMIT 1` (`pricingService.getPriceAsOf`). No background job ever flips a row from "scheduled" to "current" — that state is derived by the date comparison itself, exactly mirroring how `agreements`' "current version" is just "newest `is_current` row," just swapping a boolean flag for a date comparison.

### The as-of-date principle

Every real billing call site in `subscription.service.js` (`createSubscription`, `requestTierChange`'s direction check/proration/deferred-interval-change paths, `createRenewalReminder`) was rewired to resolve price through `pricingService.getCurrentPrice`/`getPriceAsOf` instead of a live constant, following one rule: **resolve the price as of the date the resulting billing period actually starts.** Immediate-effect changes (a new subscription, an upgrade proration, a sandbox change) resolve "now." Deferred-effect changes (a renewal, a deferred billing-interval change) resolve the date the new period actually begins — `subscription.current_period_end`. This single rule is what makes the ToS clause true without any special-casing: a renewal whose period starts before a new price's `effective_at` automatically resolves the old price, purely as a consequence of the query, decoupled from whether the notification email ever got delivered.

### Notification: `PRICE_CHANGE_ANNOUNCED` is "mandatory" — the first type not gated by preference

Publishing fans out to every tenant with `status = 'ACTIVE'` at that moment (`tenantModel.findAllByStatus`) — an in-app `PRICE_CHANGE_ANNOUNCED` notification and an email. A tenant cannot opt out of the 30-day price-change notice on any channel, so this type is "mandatory": `src/constants/non-subscribable-notification-types.js` lists it, `notificationService.createPriceChangeAnnounced()` skips the `notificationPreferenceModel.isEnabled()` gate every other notification-creating function has, and `GET/PATCH /v1/notifications/preferences` refuse to ever show or accept a preference row for it. This is a deliberate, scoped preview of the full notification-system standardization later completed in ADR-024 (a richer catalog with per-channel capability flags and a `mandatory` flag, `notification_preferences` gaining channel granularity, every type's creation eventually becoming unconditional) rather than that whole migration landing at once.

### Idempotency went through three designs before landing on "check `notifications` directly"

`pricingService.notifyPendingPriceChangesForTenant(tenantId)` has to be safe to call repeatedly (initial blast, reactivation hooks, periodic reconciliation — see below) without double-notifying. Three designs were tried, in order:

1. **A dedicated `tier_price_notifications` ledger table** (`UNIQUE(tier_price_id, tenant_id)`), written before enqueueing. Reasoning: the in-app notification insert was preference-gated at the time (a tenant who opted out of `PRICE_CHANGE_ANNOUNCED` never got a `notifications` row), so a query against `notifications` couldn't double as "have we told this tenant" without re-notifying an opted-out tenant forever.
2. **Querying `pending_effects` instead of a new table.** `pending_effects` gets a row unconditionally the instant an effect is enqueued, before any preference check — so `NOT EXISTS (... pending_effects WHERE effect_type='PRICE_CHANGE_EMAIL' ...)` seemed like a safe, table-free signal. Reverted: semantically that table tracks dispatch/delivery of async side effects (ADR-022), not business-state facts, and the `payload->>'tierPriceId'` JSONB match has no supporting index — repeated every 5 minutes (the reconciliation sweep) for the full ~30-day notice window, for every `ACTIVE` tenant, against a table that only grows and is never pruned, is real sustained cost with no benefit over a proper indexed lookup.
3. **Making `PRICE_CHANGE_ANNOUNCED` mandatory, then checking `notifications` directly (shipped).** Once the type can never be preference-gated, design 1's original objection disappears — `notifications` becomes a reliable, always-created record for this type specifically, and `tierPriceModel.findUnnotifiedPendingForTenant` (`NOT EXISTS` against `notifications` filtered by `tenant_id`/`type`/`metadata->>'tierPriceId'`, narrowed by `type` first so the JSONB match only ever scans this one tenant's small number of price-change rows, not their entire history) is both correct and cheap. No new table, no new model file.

One more correctness fix came with design 3: the in-app notification is now created **synchronously** inside `notifyPendingPriceChangesForTenant`, not via a queued `PRICE_CHANGE_NOTIFICATION` effect (which existed briefly under design 2 and was removed). A queued effect would leave an async gap between "checked as pending" and "the row actually exists" — long enough for the 5-minute reconciliation sweep to re-check the same tenant, find nothing yet in `notifications`, and double-enqueue. A `notifications` INSERT is a fast local write with nothing worth retrying, unlike the email (a real external HTTP call), so only `PRICE_CHANGE_EMAIL` stays queued. `previousPriceUsd` is computed once at that synchronous point and carried in the email effect's payload rather than recomputed whenever the queued effect eventually runs, so the email can't disagree with what the in-app notification already said.

The same idempotent function is called from three places:
1. `publishPrice()`'s initial bulk blast over every currently-`ACTIVE` tenant.
2. Every place a tenant's status transitions to `ACTIVE` (`registration.service.js`'s `verifyEmail`, `admin.service.js`'s `verifyTenant`/`updateTenantStatus`) — the reactivation catch-up case: a tenant `SUSPENDED` or still `PENDING_VERIFICATION` at publish time would otherwise be silently skipped and never know about the change.
3. `pricingService.reconcilePendingPriceChangeNotifications()`, called by `notification-scheduler.service.js`'s `runAll()` (i.e. `POST /v1/admin/jobs/notifications`, same cadence as the existing cert-check/webhook-retry steps). This is a safety net the first two don't cover: an `ACTIVE` tenant silently skipped during the publish-time bulk loop (e.g. a transient DB error on their row) is never revisited by (1) or (2), since neither fires again for a tenant who doesn't change status. The periodic sweep re-checks every `ACTIVE` tenant on a schedule regardless — cheap when nothing's pending, which is the common case.

## Consequences

### Positive
- The ToS price-change clause is now actually enforced by the data model, not just documentation.
- The as-of-date principle is a single, auditable rule applied uniformly, rather than six separate special cases.
- No dedicated idempotency table and no misuse of an unrelated outbox table — `notifications` itself is the record, made possible by `PRICE_CHANGE_ANNOUNCED` being mandatory.
- Three independent paths (initial blast, reactivation hooks, periodic sweep) all converge on notifying every `ACTIVE` tenant eventually, even if any single path fails for a given tenant.
- The "mandatory" concept and its enforcement points (creation-time gate skip, preference-endpoint rejection) are a small, real, shipped preview of the notification-system standardization later completed in ADR-024, rather than a throwaway one-off.
- `GET /v1/tiers` surfaces an announced-but-not-yet-effective price to prospective tenants too, not just existing ones.

### Negative
- Every tier-price read that used to be a synchronous constant lookup is now an `async` DB query — `GET /v1/tiers` and every `requestTierChange` branch now do 2-4 extra round trips. Acceptable at current volume; these are all low-frequency, non-hot-path operations (pricing catalog reads, tenant-initiated tier changes, a handful of scheduled-job calls per day).
- One more effect type and one more notification type add to an already-long catalogue (15 effect types, 11 notification types) — the registry pattern (`src/effects/index.js`) keeps the marginal cost of each addition small.
- `PRICE_CHANGE_ANNOUNCED` is inconsistent with every other notification type today (unconditional creation vs. preference-gated) until ADR-024 generalizes the pattern — a deliberate, documented, temporary asymmetry, not an oversight.

### Alternatives Considered
- **Moving the entire `TIERS` object to the database.** Rejected — no other tier field has ever needed history or a notice period; doing so speculatively would be scope without a corresponding requirement.
- **Versioning `IVA_RATE` the same way.** Rejected — it's not a Comprobify decision to delay, and per-payment snapshotting already provides the audit trail that matters.
- **A cron-driven "promote DRAFT/SCHEDULED to CURRENT" job.** Rejected in favor of deriving "current" from a date comparison at read time — one less moving part, and consistent with how `agreements` already avoids needing a promotion step.
- **A dedicated `tier_price_notifications` ledger table, then a `pending_effects`-backed check.** Both tried and reverted — see "Idempotency went through three designs" above.
