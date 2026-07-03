# Change Tier (Upgrade/Downgrade)

Changes the tier and/or billing interval on your existing `ACTIVE` subscription.

```
POST /v1/subscriptions/change-tier
```

## Authentication

`Authorization: Bearer <api-key>`

Requires an `ACTIVE` subscription already in place — promote with a paid tier first (see [Promote Tenant](promote-tenant.md)) and complete that initial payment review before changing tiers. To cancel entirely and return to FREE, use [`DELETE /v1/subscriptions`](cancel-subscription.md) instead.

## When to call this

No payment gateway exists yet, so this rides the same manual proof-upload-and-review pipeline as the initial subscription rather than charging anything automatically. Which of three behaviors you get depends on whether the tier changes, the billing interval changes, or both:

- **Same-interval upgrade** (target tier's price higher than your current one, `billingInterval` omitted or unchanged) takes effect immediately, gated on payment. The price difference is prorated by the fraction of your current billing period remaining — e.g. upgrading exactly halfway through a monthly cycle charges roughly half the price difference. The response includes a `payment` and `bankTransfer` instructions, just like the initial subscription; upload proof via [`PATCH /v1/payments/:id/proof`](submit-payment-proof.md) (the same endpoint, no new upload flow). Your provider reviews it and links the self-billed invoice the same way as the initial activation — once SRI authorizes that invoice, your tier flips immediately and you keep the rest of the current billing period at the new tier (it doesn't restart). If the prorated amount rounds to **$0** (almost no time left in the period), the upgrade applies immediately with no payment step at all — there'd be nothing to send proof of.
- **Same-interval downgrade** (target tier's price lower, `billingInterval` omitted or unchanged) is scheduled, not immediate, and needs no payment — you've already paid for the current period at the higher tier. Your tier and quota stay exactly as they are until `current_period_end`. The provider's scheduled job applies it automatically once that date passes.
- **Any billing-interval change** (e.g. monthly → yearly, or vice versa — regardless of whether the tier also changes) is always **deferred to `current_period_end` and billed at the new tier+interval's full price, never prorated**. Mismatched cadences can't be neatly credited against each other, so your current period simply runs out as already paid for, and the new cadence starts its own fresh, fully-paid period. You still upload proof and go through review the same way, but the tier/interval switch only takes effect once `current_period_end` arrives — even if the tier is technically going *up*. For example, switching from monthly GROWTH to yearly STARTER charges the full yearly-STARTER price and takes effect once your current monthly GROWTH period ends, not immediately.

Only one tier/interval change can be outstanding at a time — request another before the current one resolves and you'll get `409 TIER_CHANGE_ALREADY_PENDING`.

**In sandbox, all three behaviors above collapse into two simpler ones.** A sandbox subscription's billing period is discarded entirely the moment you [promote](promote-tenant.md) — there's nothing meaningful to prorate against or defer a change to. So while you're still in sandbox: a downgrade applies **immediately and for free**, and everything else (an upgrade, or any billing-interval change) is billed at the target plan's **full price, never prorated**, and applies **immediately** once its self-billed invoice authorizes — never scheduled for a period boundary. Once you promote to production, the three same-interval/interval-change behaviors described above take over as normal.

## Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `tier` | string | Yes | `STARTER`, `GROWTH`, or `BUSINESS`. |
| `billingInterval` | string | No | `MONTHLY` or `YEARLY`. Omit to keep your subscription's current interval. At least one of `tier`/`billingInterval` must actually change from your current subscription, or you'll get `400 TIER_CHANGE_NO_OP`. |

## Response

**201 Created** — same-interval upgrade (payment required)

```json
{
  "ok": true,
  "subscription": {
    "id": 12,
    "tenant_id": 4,
    "tier": "STARTER",
    "billing_interval": "MONTHLY",
    "status": "ACTIVE",
    "current_period_start": "2026-06-15T00:00:00.000Z",
    "current_period_end": "2026-07-15T00:00:00.000Z"
  },
  "payment": {
    "id": 25,
    "subscription_id": 12,
    "status": "PENDING",
    "amount": "30.00",
    "method": "SPI_TRANSFER",
    "purpose": "TIER_CHANGE",
    "target_tier": "GROWTH",
    "target_billing_interval": null
  },
  "bankTransfer": {
    "bankName": "...",
    "accountType": "...",
    "accountNumber": "...",
    "accountHolder": "...",
    "identification": "..."
  }
}
```

**201 Created** — same-interval upgrade applying immediately (prorated amount rounded to $0)

```json
{
  "ok": true,
  "subscription": {
    "id": 12,
    "tier": "GROWTH"
  },
  "payment": null,
  "amount": 0
}
```

**201 Created** — same-interval downgrade (scheduled, no payment)

```json
{
  "ok": true,
  "subscription": {
    "id": 12,
    "tier": "GROWTH",
    "pending_tier": "STARTER"
  },
  "effectiveAt": "2026-07-15T00:00:00.000Z"
}
```

**201 Created** — billing-interval change (deferred, full price, tier example shown is a downgrade)

```json
{
  "ok": true,
  "subscription": {
    "id": 12,
    "tenant_id": 4,
    "tier": "GROWTH",
    "billing_interval": "MONTHLY",
    "status": "ACTIVE",
    "current_period_end": "2026-07-15T00:00:00.000Z"
  },
  "payment": {
    "id": 26,
    "subscription_id": 12,
    "status": "PENDING",
    "total_amount": "200.00",
    "method": "SPI_TRANSFER",
    "purpose": "TIER_CHANGE",
    "target_tier": "STARTER",
    "target_billing_interval": "YEARLY"
  },
  "bankTransfer": {
    "bankName": "...",
    "accountType": "...",
    "accountNumber": "...",
    "accountHolder": "...",
    "identification": "..."
  },
  "effectiveAt": "2026-07-15T00:00:00.000Z"
}
```

The subscription itself (`tier`/`billing_interval`) does **not** change yet in this response — it only flips once the payment is verified, the self-billed invoice is authorized, and `current_period_end` arrives.

## What happens next

You'll get a `PAYMENT_VERIFIED`/`PAYMENT_REJECTED` notification and email when a payment's review completes (see [Notifications](notifications.md)) — there's still no notification for the moment a same-interval downgrade's or a billing-interval change's tier/interval actually flips, since nothing was paid or rejected at that exact moment for one to fire on. Poll [`GET /v1/subscriptions/me`](get-my-subscriptions.md) for status, [`GET /v1/tenants/me`](tenant-me.md) for just the resulting tier/quota once it lands, or [`GET /v1/tenants/events`](tenant-events.md) to see the full history of tier/interval changes over time (`TIER_CHANGE_REQUESTED` → `TIER_CHANGE_SCHEDULED` → `TIER_CHANGED`, each with `fromBillingInterval`/`toBillingInterval` in `detail`).

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `INVALID_TIER` | `tier` is not `STARTER`, `GROWTH`, or `BUSINESS` |
| `400` | `INVALID_BILLING_INTERVAL` | `billingInterval` is supplied but is not `MONTHLY` or `YEARLY` |
| `400` | `TIER_CHANGE_NO_OP` | Both `tier` and the resolved `billingInterval` match your subscription's current values |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `NOT_FOUND` | Tenant could not be resolved (should not normally happen for an authenticated request) |
| `409` | `NO_ACTIVE_SUBSCRIPTION` | You have no `ACTIVE` subscription — promote with a paid tier and complete that payment review first |
| `409` | `TIER_CHANGE_ALREADY_PENDING` | A change is already scheduled, or a payment is already in flight, for this subscription |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |
