# ADR-033: Immediate Proration for a MONTHLY → YEARLY Upgrade

## Status
Accepted

## Date
2026-09-04

## Context

Every billing-interval change — same tier, upgrade, or downgrade — was deferred to `current_period_end` and billed at the new tier+interval's full sticker price, with no proration at all. The stated reasoning (see the CLAUDE.md text this ADR updates): "mismatched cadences (monthly vs. yearly) can't be neatly prorated against each other."

That framing understated the real constraint. Prorating a cross-interval change is entirely computable — credit the unused value of the current period, charge the new period's full price minus that credit — the actual blocker is that **this codebase has no mechanism to pay money back to a tenant**. `PATCH /v1/admin/payments/:id/refund` is explicit about this: it "moves no money," it only restores internal state; an actual reversal to the tenant's bank account is always a manual, out-of-band step (SPI has no automated reversal API at all, and Payphone's only works same-day). Any proration scheme that could produce a *negative* charge — a credit exceeding the new period's cost — has nowhere to send that credit. So the deferred, unprorated design wasn't really about cadence mismatch; it was a blanket workaround for the refund-payout gap, applied uniformly to every direction even though most directions don't actually risk it.

This was surfaced by a real user report: switching STARTER MONTHLY → ENTERPRISE YEARLY — an unambiguous upgrade — still had to wait a full month at the old tier before the new plan (and its much larger revenue) took effect, purely because the interval also changed. That's lost/delayed revenue with no corresponding risk this design needed to guard against.

## Decision

**A MONTHLY → YEARLY switch that is a genuine upgrade by monthly-equivalent price applies immediately, with a same-day proration credit — every other interval-change direction keeps the existing deferred, full-price, no-proration behavior.**

"Genuine upgrade" is defined as: `(targetYearlyPrice / 12) > currentMonthlyPrice`. This specific direction is safe by construction:

- The credit for unused time in the old plan is capped at, at most, one month's worth of the *old* (by definition, cheaper) plan's price: `credit = currentMonthlyPrice × remainingFraction`, where `remainingFraction ≤ 1`.
- The new charge is a full **year** at the *new* (by definition, pricier) monthly-equivalent rate: `newFullPrice = targetYearlyPrice + seats × seatPrice`.
- Since `targetYearlyPrice / 12 > currentMonthlyPrice`, `targetYearlyPrice > 12 × currentMonthlyPrice ≥ 12 × credit`. The new charge is always at least ~11× the maximum possible credit — the math cannot produce a negative amount, with or without seats (seats only add to `newFullPrice`, widening the margin further).

No other direction has this guarantee:
- **YEARLY → MONTHLY**, in either tier direction, is unsafe: the credit horizon (up to a full year of the old plan) can dwarf the charge horizon (one month of the new plan) whenever the two tiers are anywhere near comparable in price. Example: BUSINESS YEARLY ($2300/yr ≈ $191.67/mo) → BUSINESS MONTHLY ($230/mo) is nominally a monthly-equivalent "upgrade," but a credit of up to $2300 against a $230 charge would be deeply negative.
- **MONTHLY → YEARLY that is a downgrade or tie by monthly-equivalent** is unsafe for the same reason in miniature: e.g. BUSINESS MONTHLY ($230/mo) → STARTER YEARLY ($200/yr ≈ $16.67/mo) could credit up to $230 against a $200 charge.

So the safe case is narrow and specific — not "any upgrade," not "any MONTHLY → YEARLY switch," but the intersection of both.

**Mechanics:**

- `requestTierChange`'s new branch computes the credit/charge as described above and creates a `payments` row exactly like a same-interval upgrade, except it also sets `target_billing_interval` (the new interval) **and** a new column, `interval_change_immediate: true` (migration 099).
- This decision is made **once, at request time, and persisted** — not re-derived from (possibly since-changed) pricing data at payment-verification time. A price change between request and verification must not flip which code path a payment takes; the amount charged and the path taken must always agree.
- `applyVerifiedPayment` → `applyTierChangePayment` checks `interval_change_immediate` before the existing `target_billing_interval && !tenant.sandbox` defer check. If set, it applies the tier **and** starts a genuinely new period right now (`applyImmediateIntervalUpgrade`: `subscriptionModel.applyTierChange` + `updateStatus` with a fresh `current_period_start`/`current_period_end` anchored to "now" + `tenantQuotaService.syncPeriod`, not `setCap` — this is a new period, not a mid-cycle cap resize, see ADR-029's addendum) — unlike the same-interval case, which keeps the existing cycle's dates ("takes over the remainder").
- The `$0`-or-negative edge case (mathematically near-unreachable given the safety margin above) is handled the same defensive way the same-interval upgrade's own `$0` case is: applied directly via the shared helper, no payment created, since a tenant can't submit proof of a $0 transfer.
- Every other interval-change direction is completely unchanged: same deferred branch, same full-price billing, same `scheduleDowngrade`/`applyScheduledTierChanges` mechanics as before this ADR.

## Consequences

### Positive
- Closes a real revenue-timing gap: a tenant ready to pay for a much larger plan today no longer has to wait out an unrelated interval technicality.
- The safety proof is a hard mathematical guarantee, not a heuristic — no scenario within the defined "genuine upgrade, MONTHLY → YEARLY" case can produce a negative charge.
- Zero behavior change for every other interval-change direction — the existing deferred path, its tests, and its guarantees are untouched.

### Negative
- Asymmetric: a tenant switching YEARLY → MONTHLY, even as a clear upgrade, still waits for period end. This is deliberate (see Context/Decision) but is a real UX inconsistency a support agent will need to explain.
- Adds a second signal (`interval_change_immediate`) alongside `target_billing_interval` on `payments` — a payment with `target_billing_interval` set no longer implies "this defers"; both columns must be read together. Flagged explicitly in CLAUDE.md's "Tier and billing-interval changes" and the Key Files table to avoid the two being conflated later.

### Mitigation
- The persisted flag (rather than re-deriving eligibility at verification time) means a price change mid-flight can never cause a payment to apply along a path its own charged amount doesn't match.

### Alternatives Considered
- **Prorate every interval-change direction, capping the charge at $0.** Rejected: silently discarding a credit the tenant is nominally owed (e.g. the BUSINESS YEARLY → BUSINESS MONTHLY case above) is worse than the current deferred behavior — the tenant would have paid for a full year and received only a fraction of it back as a $0-floor "you're welcome," a materially worse outcome than simply waiting for the period they already paid for to run out.
- **Build a real credit-balance/refund mechanism** so any direction could prorate safely. Rejected as disproportionate: it would touch the entire payment/refund pipeline (a new balance concept, interactions with `PATCH /v1/admin/payments/:id/refund`, SPI/Payphone reconciliation) to solve a problem the narrow MONTHLY → YEARLY case doesn't actually have. Worth revisiting only if a future direction genuinely needs it.
- **Classify "upgrade" by comparing full-period sticker prices directly** (yearly vs. monthly, unnormalized) instead of monthly-equivalent. Rejected: doesn't answer the right question ("will this cost you more per month going forward?") and would misclassify e.g. a cheap YEARLY plan against an expensive MONTHLY one.
