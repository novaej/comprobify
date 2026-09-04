# Billing Operations — the Operator's Side, End to End

Everything that happens between a tenant deciding to pay and you having issued them a factura. This is the operator-facing counterpart to the tenant-facing [Your subscription & billing](../site/en/paying-your-subscription.md) page.

For the card-payment path specifically — its failure modes, the five-minute confirm window, and the "I paid but nothing happened" diagnostic path — see [payphone-payments.md](payphone-payments.md). This guide is the wider pipeline.

Design rationale lives in [ADR-017](../adr/017-subscription-payment-pipeline.md) (the pipeline), [ADR-027](../adr/027-decouple-activation-from-invoice.md) (why activation no longer waits on the invoice) and [ADR-028](../adr/028-payphone-card-payments.md) (card payments).

---

## The one thing to internalise

**A verified payment *is* the grant of access.** The moment a payment reaches `VERIFIED`, `subscriptionService.applyVerifiedPayment()` activates the subscription, flips the tier, or extends the period — whichever the payment's `purpose` calls for — and the tenant has what they paid for.

Your invoice comes *after*, and holds up nothing. That's the whole of ADR-027: issuing the factura is your legal obligation on your clock, and gating the customer's service on it made them absorb your SRI outages.

So there are two independent things to keep on top of, and it helps to hold them apart:

| | Tracked by | Where you see it |
|---|---|---|
| Money owed to you | `payments.status` | `GET /v1/admin/payments?status=REPORTED` |
| Facturas owed by you | `payments.invoiced_at` | `GET /v1/admin/invoicing/pending` |

---

## 1. How money reaches you

Two methods, converging on the same place.

**Card (Payphone).** Verifies itself. No action from you — by the time you hear about it the tenant is already active. You get an email because nothing else would tell you a factura is now owed.

**SPI bank transfer.** The tenant transfers, then uploads proof plus their bank's reference number. The payment moves to `REPORTED` and waits for you. You get an email when proof lands.

Every payment also carries a `payment_code` (e.g. `CB-4K7N9QRT`, migration 097) — a short, hand-typable code the tenant is asked to include in the transfer's own description/glosa. It's generated at creation time (DB `DEFAULT`, no application code involved) and never changes for that payment. Use it as a second cross-reference against the bank statement's free-text field, alongside the tenant-supplied `referenceNumber` below — some banks preserve the description, some don't, so treat it as a helpful hint, not a guarantee.

Both end at `applyVerifiedPayment`, so everything downstream — periods, tier changes, refunds — behaves identically regardless of method.

## 2. Reviewing an SPI proof

Your queue:

```
GET /v1/admin/payments?status=REPORTED
```

Look at the files (`GET /v1/admin/payments/:id/proofs`, then `.../proofs/:proofId` to view one). The `referenceNumber` the tenant supplied is your cross-reference against the bank statement. Then:

```
PATCH /v1/admin/payments/:id/review
{ "decision": "VERIFIED" }
{ "decision": "REJECTED", "rejectionReasonCode": "TRANSFER_NOT_FOUND" }
```

`rejectionReasonCode` is **required** when rejecting, and must be one of `AMOUNT_MISMATCH`, `TRANSFER_NOT_FOUND`, `WRONG_ACCOUNT`, `ILLEGIBLE_PROOF`, `DUPLICATE_SUBMISSION`, `OTHER`. It's an enum rather than free text because the tenant sees it — their UI maps the code to its own wording.

**Rejection is not a dead end.** The tenant uploads fresh proof for the *same* payment and it returns to `REPORTED`. Nothing already uploaded is deleted; you keep the full history across attempts, including from rejected rounds. A tenant can soft-delete a file from their own view, but you still see every one.

Either decision emails the tenant and raises a notification, fanned out to their webhooks. You don't need to tell them separately.

## 3. Issuing the factura

```
GET /v1/admin/invoicing/pending   ->  { count, items[] }
```

Every verified payment whose factura you still owe. Each item carries the amounts, the period being billed, and the buyer's legal identity (`businessName`, `ruc`, `address`) so you can prefill the invoice without a second lookup.

Watch one detail: for a `TIER_CHANGE` payment, `subscription.tier`/`billingInterval` in the response are already the **target** values — what the tenant actually bought, not what their subscription currently reads. Bill what the response says.

Issue the invoice through your own issuer the normal way, then record it:

```
PATCH /v1/admin/subscriptions/:id/link-invoice   { "accessKey": "<49 digits>" }
```

This is **pure bookkeeping** — it changes no subscription state. It stamps `invoiced_at`, which clears the item from the queue. Returns `409` if that subscription has no verified payment awaiting an invoice.

A sandbox-issued invoice is fine for testing: `invoiced_at` is still stamped, though neither foreign key is stored (both reference `public.documents`, and sandbox ids can collide with them).

## 4. Renewals, grace, and PAST_DUE

Driven by `POST /v1/admin/jobs/subscriptions` (daily), which runs scheduled tier changes first, then renewals — that order matters and shouldn't be swapped.

- **~7 days before** `current_period_end`: a `RENEWAL` payment is opened and the tenant is reminded by notification and email.
- **~5 days past** it: a second, more urgent warning.
- **~7 days past** it: the subscription expires. The tenant drops to FREE and their account becomes `PAST_DUE`.

`PAST_DUE` is **not** `SUSPENDED` and shouldn't be treated as one. It's automated, and self-resolving: the tenant starts a fresh subscription, pays it, and returns to `ACTIVE` with no involvement from you. That's why `POST /v1/subscriptions` and the proof-upload endpoint stay reachable for a `PAST_DUE` tenant while everything else is blocked.

## 5. Refunds and reversals

Nothing tells you a payment was reversed — an SPI reversal shows up only on your bank statement, and Payphone documents no notification for cardholder chargebacks. Detection is yours.

> **`PATCH /v1/admin/payments/:id/refund` moves no money.** It touches only our
> database — restores the tier/period, marks the payment `REFUNDED`, logs the
> event. It makes **no call to Payphone and none to your bank.** Returning the
> money is always a separate, manual step. This is deliberate: an SPI reversal
> can't be automated at all, and Payphone's reverse API only works same-day, so
> automating one method and not the other would give two different procedures
> for the same situation.

Once you know:

1. **Return the money first** — your bank, or the Payphone Business dashboard (same-day only, until 20:00 EC).
2. **Then roll our side back:**

```
PATCH /v1/admin/payments/:id/refund   { "reason": "SPI reversed by bank, ref 8891" }
```

**This is not "downgrade to FREE", and that distinction is the reason the endpoint exists.** It restores `payments.applied_from`, a snapshot taken immediately before the payment was applied:

| Reversed payment | Rolls back to |
|---|---|
| `TIER_CHANGE` | The **previous paid tier** — not FREE |
| `RENEWAL` | The previous period. Tier untouched |
| `INITIAL` | FREE, and the subscription is cancelled so they can start fresh |

Doing this by hand via `PATCH /v1/admin/tenants/:id/tier` is actively wrong: that writes only `tenants.subscription_tier` and never `subscriptions.tier`, so the subscription keeps claiming the reversed tier and the *next renewal is priced off it* — the tenant gets billed for an upgrade they never paid for.

Refusals: `409` if the payment isn't `VERIFIED`; `400 PAYMENT_NOT_REFUNDABLE` if it predates the snapshot column (migration 090) — adjust manually in that case rather than guessing.

The endpoint deliberately **does not suspend** anyone. Whether a reversal is fraud or an honest duplicate is your call, made separately.

### Why the order matters

Money first, then our side. Reversed, and you have a tenant who is **downgraded but still charged** — nothing in the system flags that mismatch, because as far as it knows the refund succeeded. If the Payphone reversal then fails (past 20:00 EC, an API error, a transaction too old), you have to notice and undo the rollback yourself.

If the money side can't be reversed — the usual case for anything found more than a day later, and for every chargeback — decide what you actually owe the tenant before touching our side at all. Rolling back a payment the customer never got returned takes their tier away *and* keeps their money.

### The one case where you must NOT call this endpoint

A **duplicate charge** (`payphone_transactions.status = 'DUPLICATE'`): the tenant paid twice for one payment. Refund the duplicate in Payphone's dashboard, and stop there. The subscription is correctly paid for by the other attempt, and the duplicate never touched subscription state — so there is nothing on our side to roll back. Calling refund here would strip a tier the tenant legitimately paid for.

### What the refund does not update

`payphone_transactions` is left alone: the attempt stays `APPROVED` with its `applied_at`. That is historically accurate — it *was* approved and applied — and `payments.status = 'REFUNDED'` carries the current truth. But there is no back-link, so reading only the attempt table suggests the charge still stands. Worth knowing if you ever reconcile against Payphone's own transaction list.

## 6. Suspending an account

```
PATCH /v1/admin/tenants/:id/status
{ "status": "SUSPENDED", "suspensionReasonCode": "PAYMENT_REVERSED" }
```

`suspensionReasonCode` is required when suspending: `PAYMENT_REVERSED`, `FRAUD_SUSPECTED`, `TERMS_VIOLATION`, `VOLUNTARY_CLOSURE`, `UNPAID_BALANCE`, `OTHER`.

**The tenant can read this.** It's stored on `tenants.suspension_reason_code` (surfaced on their own `GET /v1/tenants/me`) and mirrored into the `STATUS_CHANGED` event, which `GET /v1/tenants/events` exposes to them. It's an enum precisely so their UI shows its own localized wording rather than operator prose — the same fix migration 068 applied to payment rejections.

`VOLUNTARY_CLOSURE` is not punitive. The product has no separate "closed" status, so a customer asking to close their account lands in `SUSPENDED` too — don't let the UI word that as a sanction.

Reactivating (`"status": "ACTIVE"`) needs no reason code and clears the column; the historical event survives.

## 7. Verifying one payment end to end

A payment touches ten tables. Four carry the state that has to agree — `payments`, `subscriptions`, `tenants`, `tenant_quotas` — and the rest are evidence: `payment_proofs` (SPI), `payphone_transactions` (card), `tenant_events`, `notifications`, `pending_effects`, and `documents` for the factura.

Listing them isn't the useful part. **"Correct" means these invariants hold:**

| # | Invariant | Why it breaks |
|---|---|---|
| 1 | `VERIFIED` ⟹ `verified_at` set | — |
| 2 | Applied ⟹ `period_start` stamped | Exception: a *deferred* `TIER_CHANGE` sets `pending_tier` instead and stays unstamped until it lands |
| 3 | `subscriptions.tier` == `tenants.subscription_tier` | A hand-rolled tier edit writes only the tenant. The next renewal is then priced off a tier nobody paid for |
| 4 | `tenant_quotas.document_quota` matches that tier *and* `billing_interval` | `updateTier` and `setCap` are separate calls; miss one and the tier changes while the cap doesn't. Since ADR-029, the expected cap also depends on `tenant_quotas.billing_interval`: a YEARLY period's cap is the tier's monthly figure × 12, not the flat monthly one — and ENTERPRISE's cap is always `NULL` (genuinely unlimited), regardless of interval |
| 5 | Card ⟹ an `APPROVED` attempt with `applied_at` | `applied_at` null means captured but never credited |
| 6 | `invoiced_at IS NULL` ⟹ factura still owed | — |

One payment, whole chain:

```sql
SELECT p.id AS payment_id, p.payment_code, p.purpose, p.method, p.status AS payment_status,
       p.total_amount, p.verified_at, p.invoiced_at,
       (p.applied_from IS NOT NULL) AS has_rollback_snapshot,
       (p.period_start IS NOT NULL) AS applied,
       s.status AS sub_status, s.tier AS sub_tier, s.billing_interval, s.pending_tier,
       s.current_period_start, s.current_period_end,
       t.subscription_tier AS tenant_tier, t.status AS tenant_status,
       q.document_quota AS quota_cap,
       pt.status AS card_attempt, pt.applied_at AS card_applied_at,
       (SELECT count(*) FROM payment_proofs pp WHERE pp.payment_id = p.id AND pp.active) AS active_proofs,
       (SELECT count(*) FROM notifications n
          WHERE n.tenant_id = s.tenant_id AND (n.metadata->>'paymentId') = p.id::text) AS notifications,
       (SELECT count(*) FROM pending_effects pe
          WHERE pe.tenant_id = s.tenant_id AND pe.status = 'FAILED') AS failed_effects
FROM payments p
JOIN subscriptions s ON s.id = p.subscription_id
JOIN tenants t       ON t.id = s.tenant_id
LEFT JOIN tenant_quotas q ON q.tenant_id = t.id AND q.is_current
LEFT JOIN payphone_transactions pt ON pt.payment_id = p.id AND pt.status <> 'CANCELLED'
WHERE p.id = '<PAYMENT_ID>' OR p.payment_code = '<PAYMENT_CODE>';
```

`payment_code` is useful here specifically when all you have is a bank statement description (a tenant referenced it there instead of the UUID) and no `<PAYMENT_ID>` yet.

`has_rollback_snapshot = false` on a `VERIFIED` payment means it predates migration 090 — `PATCH /v1/admin/payments/:id/refund` will refuse it and the rollback has to be done by hand.

### Verifying a prorated TIER_CHANGE amount

A same-interval upgrade (`requestTierChange`'s immediate branch, `subscription.service.js`) prorates by **time remaining in the period, not usage**:

```
proratedBase = round((toTierPrice - fromTierPrice) × remainingFraction, 2)
remainingFraction = (current_period_end - requestedAt) / (current_period_end - current_period_start)
```

Two things catch people out:

- It's the **price difference** that's prorated, not the new tier's full sticker price. On the same day a subscription starts, `remainingFraction` is close to `1`, so the charge lands close to the *full* difference between the two tiers — e.g. LITE ($8/mo) → STARTER ($20/mo) minutes after signup prorates to something like `(20 - 8) × 0.996 ≈ 11.95`, not "$20 minus a small proration" and not "$20 minus $8." That's expected, not a bug.
- Both `toTierPrice` and `fromTierPrice` resolve to whatever was `PUBLISHED` and effective **as of the moment the upgrade was requested** (`payments.created_at`) — not necessarily what the tenant originally paid for the old tier, if a price changed in between (see "Price history + 30-day change notice" in CLAUDE.md).

To check a specific payment, fill in `<PAYMENT_ID>` and the tier the tenant was upgrading *from* (check `tenant_events` for the `TIER_CHANGE_REQUESTED` row around the same timestamp — `payments` itself only stores `target_tier`, the tier being upgraded *to*):

```sql
SELECT
  p.id AS payment_id, p.payment_code, p.created_at AS requested_at,
  p.amount AS charged_base, p.total_amount AS charged_total,
  s.current_period_start, s.current_period_end,
  from_price.price_usd AS from_tier_price,
  to_price.price_usd   AS to_tier_price,
  ROUND(
    EXTRACT(EPOCH FROM (s.current_period_end - p.created_at))::numeric /
    EXTRACT(EPOCH FROM (s.current_period_end - s.current_period_start))::numeric
  , 6) AS remaining_fraction,
  ROUND(
    (to_price.price_usd - from_price.price_usd) *
    (EXTRACT(EPOCH FROM (s.current_period_end - p.created_at))::numeric /
     EXTRACT(EPOCH FROM (s.current_period_end - s.current_period_start))::numeric)
  , 2) AS expected_charged_base
FROM payments p
JOIN subscriptions s ON s.id = p.subscription_id
JOIN LATERAL (
  SELECT price_usd FROM tier_prices
  WHERE tier = '<FROM_TIER>' AND billing_interval = s.billing_interval
    AND status = 'PUBLISHED' AND effective_at <= p.created_at
  ORDER BY effective_at DESC LIMIT 1
) from_price ON true
JOIN LATERAL (
  SELECT price_usd FROM tier_prices
  WHERE tier = p.target_tier AND billing_interval = s.billing_interval
    AND status = 'PUBLISHED' AND effective_at <= p.created_at
  ORDER BY effective_at DESC LIMIT 1
) to_price ON true
WHERE p.id = '<PAYMENT_ID>' OR p.payment_code = '<PAYMENT_CODE>';
```

`expected_charged_base` should equal `charged_base` (rounding aside — each is rounded independently to 2 decimals). If they disagree by more than a cent, something upstream is wrong (stale `current_period_end`, a price resolved at the wrong instant, etc.) — worth pulling the surrounding `TIER_CHANGE_REQUESTED` tenant event for the exact inputs `requestTierChange` used.

### Auditing every payment at once

More useful than checking one at a time. This returns a `problem` column, null when a payment is consistent:

```sql
SELECT p.id AS payment_id, s.tenant_id, p.purpose, p.status,
  CASE
    WHEN p.status = 'VERIFIED' AND p.verified_at IS NULL           THEN 'VERIFIED without verified_at'
    WHEN p.status = 'VERIFIED' AND p.period_start IS NULL
         AND s.pending_tier IS NULL                                THEN 'verified but never applied'
    WHEN p.status = 'VERIFIED' AND s.tier <> t.subscription_tier   THEN 'subscription.tier disagrees with tenant tier'
    WHEN p.status = 'VERIFIED' AND q.document_quota IS DISTINCT FROM
         CASE WHEN t.subscription_tier = 'ENTERPRISE' THEN NULL ELSE
           (CASE t.subscription_tier
              WHEN 'FREE' THEN 5 WHEN 'SOLO' THEN 15 WHEN 'LITE' THEN 50
              WHEN 'STARTER' THEN 200 WHEN 'GROWTH' THEN 1000 WHEN 'BUSINESS' THEN 4000 END)
           * (CASE WHEN s.billing_interval = 'YEARLY' AND t.subscription_tier <> 'FREE' THEN 12 ELSE 1 END)
         END                                              THEN 'quota cap does not match tier/interval'
    WHEN p.method = 'PAYPHONE_CARD' AND p.status = 'VERIFIED'
         AND NOT EXISTS (SELECT 1 FROM payphone_transactions x
                         WHERE x.payment_id = p.id AND x.status = 'APPROVED'
                           AND x.applied_at IS NOT NULL)           THEN 'card payment with no applied attempt'
  END AS problem
FROM payments p
JOIN subscriptions s ON s.id = p.subscription_id
JOIN tenants t       ON t.id = s.tenant_id
LEFT JOIN tenant_quotas q ON q.tenant_id = t.id AND q.is_current
WHERE p.status = 'VERIFIED';
```

The tier quotas are inlined rather than joined, since they live in `src/constants/subscription-tiers.js` and not in the database — update them here if the tier definitions change (including the `× 12` YEARLY multiplier and ENTERPRISE's `NULL` case, both from `tenantQuotaService.capForTier()`/`periodMonthsForTier()`, if that logic ever changes).

## 8. When a tenant says they paid and nothing happened

Card payments have their own diagnostic path in [payphone-payments.md](payphone-payments.md). For a transfer:

```sql
SELECT p.id, p.status, p.purpose, p.method, p.total_amount,
       p.reported_at, p.verified_at, p.invoiced_at, p.rejection_reason_code,
       s.status AS subscription_status, s.tier, s.current_period_end
FROM payments p
JOIN subscriptions s ON s.id = p.subscription_id
JOIN tenants t       ON t.id = s.tenant_id
WHERE t.email = '<email>'
ORDER BY p.created_at DESC;
```

| What you see | What it means |
|---|---|
| `PENDING`, no `reported_at` | They never uploaded proof. Nothing is waiting on you. |
| `REPORTED` | **It's in your queue.** Review it. |
| `REJECTED` | You rejected it; `rejection_reason_code` says why. They can re-upload. |
| `VERIFIED`, subscription `ACTIVE` | It worked. If they say otherwise, check tier/quota rather than payment. |
| `VERIFIED`, `invoiced_at` NULL | Fine for them — but you owe the factura. |
| `REFUNDED` | Rolled back; `applied_from` shows what it restored. |

## A note on your own tenant

You need a tenant row and an issuer of your own to self-bill from, so the operator *is* a tenant in this system — and nothing distinguishes that row from a customer's.

**Don't give it a subscription and don't invoice yourself.** A subscription would open `RENEWAL` payments, email you renewal reminders about yourself, and eventually mark your own account `PAST_DUE` for not paying you. And a factura needs an emisor and a receptor who are different taxable persons — issuing one to your own RUC for your own service isn't a sale. (Whether Ecuadorian rules want anything recorded for own-use of your own service is an accountant's question, not this guide's.)

**Do raise its quota.** Every production document consumes the issuing tenant's quota with no operator exemption, so you burn your own allowance issuing subscription invoices to customers — one per paying tenant per month. On FREE (5/month) that fails almost immediately with a `402 QUOTA_EXCEEDED` that reads like a bug. Set it once:

```
PATCH /v1/admin/tenants/:id/tier   { "tier": "ENTERPRISE" }
```

That's an admin override: it sets the tier and quota cap without creating a subscription. ENTERPRISE has a genuinely unlimited quota (`document_quota` becomes `NULL`, not a large number — see ADR-029), which is the right fit for the operator's own housekeeping tenant since there's no real cap that makes sense here; BUSINESS (4,000/month) still works too if you'd rather keep a visible ceiling. The tenant also has to be promoted (`sandbox = false`) to issue production documents at all.

**Your tenant is a real business, not just a bookkeeping vehicle.** The same issuer will emit subscription invoices to Comprobify customers *and* invoices for your other work to unrelated clients. Two things follow:

- **Consider a dedicated issue point for subscription invoicing**, separate from your other work. `BUSINESS` allows unlimited branches and issue points, and `POST /v1/issuers` with `sourceIssuerId` copies your existing certificate — so it costs nothing beyond deciding. It keeps SRI sequential ranges cleanly separated for accounting, and makes "which of these invoices were subscriptions?" a filter on `issuer_id` rather than a join through `subscriptions.initial_invoice_document_id` / `payments.invoice_document_id`, which is the only way to tell them apart today. **Decide this before volume accumulates** — sequential ranges can't be retroactively split.
- **When reports eventually exist, don't just "exclude the operator".** Your subscription is self-paid and must stay out of MRR; your documents are genuine usage and should stay *in* usage counts; and your own invoiced work is your business income, not Comprobify revenue. Three different answers, one tenant.

The wider gap — a real `OPERATOR_TENANT_ID` so the operator can be handled correctly for quota, renewals and each kind of reporting (while still getting certificate-expiry alerts, which matter most for them) — is NEXT_STEPS.md #5.

## Related

- [payphone-payments.md](payphone-payments.md) — the card path in depth
- [testing-scheduled-jobs.md](testing-scheduled-jobs.md) — SQL recipes to force renewals, expiry, quota rollover and Payphone reconciliation locally
- CLAUDE.md's "Subscription + payment pipeline" entry — the implementation-level map
