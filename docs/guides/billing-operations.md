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

Once you know:

1. **Reverse on the money side first** — your bank, or the Payphone Business dashboard (same-day only, until 20:00 EC).
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

## 6. Suspending an account

```
PATCH /v1/admin/tenants/:id/status
{ "status": "SUSPENDED", "suspensionReasonCode": "PAYMENT_REVERSED" }
```

`suspensionReasonCode` is required when suspending: `PAYMENT_REVERSED`, `FRAUD_SUSPECTED`, `TERMS_VIOLATION`, `VOLUNTARY_CLOSURE`, `UNPAID_BALANCE`, `OTHER`.

**The tenant can read this.** It's stored on `tenants.suspension_reason_code` (surfaced on their own `GET /v1/tenants/me`) and mirrored into the `STATUS_CHANGED` event, which `GET /v1/tenants/events` exposes to them. It's an enum precisely so their UI shows its own localized wording rather than operator prose — the same fix migration 068 applied to payment rejections.

`VOLUNTARY_CLOSURE` is not punitive. The product has no separate "closed" status, so a customer asking to close their account lands in `SUSPENDED` too — don't let the UI word that as a sanction.

Reactivating (`"status": "ACTIVE"`) needs no reason code and clears the column; the historical event survives.

## 7. When a tenant says they paid and nothing happened

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
PATCH /v1/admin/tenants/:id/tier   { "tier": "BUSINESS" }
```

That's an admin override: it sets the tier and quota cap without creating a subscription. BUSINESS is 4,000 documents/month. The tenant also has to be promoted (`sandbox = false`) to issue production documents at all.

The wider gap — a real `OPERATOR_TENANT_ID` so the operator can be excluded from quota, renewals and revenue reporting (while still getting certificate-expiry alerts, which matter most for them) — is NEXT_STEPS.md #5.

## Related

- [payphone-payments.md](payphone-payments.md) — the card path in depth
- [testing-scheduled-jobs.md](testing-scheduled-jobs.md) — SQL recipes to force renewals, expiry, quota rollover and Payphone reconciliation locally
- CLAUDE.md's "Subscription + payment pipeline" entry — the implementation-level map
