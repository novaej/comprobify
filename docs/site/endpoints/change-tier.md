# Change Tier (Upgrade/Downgrade)

Changes the tier on your existing `ACTIVE` subscription.

```
POST /v1/subscriptions/change-tier
```

## Authentication

`Authorization: Bearer <api-key>`

Requires an `ACTIVE` subscription already in place — promote with a paid tier first (see [Promote Tenant](promote-tenant.md)) and complete that initial payment review before changing tiers. To cancel entirely and return to FREE, use [`DELETE /v1/subscriptions`](cancel-subscription.md) instead.

## When to call this

No payment gateway exists yet, so this rides the same manual proof-upload-and-review pipeline as the initial subscription rather than charging anything automatically. The two directions behave differently because one owes money and one doesn't:

- **Upgrade** (target tier's price higher than your current one) takes effect immediately, gated on payment. The price difference is prorated by the fraction of your current billing period remaining — e.g. upgrading exactly halfway through a monthly cycle charges roughly half the price difference. The response includes a `payment` and `bankTransfer` instructions, just like the initial subscription; upload proof via [`PATCH /v1/payments/:id/proof`](submit-payment-proof.md) (the same endpoint, no new upload flow). Your provider reviews it and links the self-billed invoice the same way as the initial activation — once SRI authorizes that invoice, your tier flips immediately and you keep the rest of the current billing period at the new tier (it doesn't restart). If the prorated amount rounds to **$0** (almost no time left in the period), the upgrade applies immediately with no payment step at all — there'd be nothing to send proof of.
- **Downgrade** (target tier's price lower) is scheduled, not immediate, and needs no payment — you've already paid for the current period at the higher tier. Your tier and quota stay exactly as they are until `current_period_end`. The provider's scheduled job applies it automatically once that date passes.

Only one tier change can be outstanding at a time — request another before the current one resolves and you'll get `409 TIER_CHANGE_ALREADY_PENDING`.

## Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `tier` | string | Yes | `STARTER`, `GROWTH`, or `BUSINESS`. Must differ from your subscription's current tier. |

## Response

**201 Created** — upgrade (payment required)

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
    "target_tier": "GROWTH"
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

**201 Created** — upgrade applying immediately (prorated amount rounded to $0)

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

**201 Created** — downgrade (scheduled)

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

## What happens next

You'll get a `PAYMENT_VERIFIED`/`PAYMENT_REJECTED` notification and email when the upgrade's payment review completes (see [Notifications](notifications.md)) — there's still no notification for a downgrade's scheduled tier flip, since nothing was paid or rejected for that to fire on. Poll [`GET /v1/subscriptions/me`](get-my-subscriptions.md) for status, or [`GET /v1/tenants/me`](tenant-me.md) for just the resulting tier/quota once it lands.

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `INVALID_TIER` | `tier` is not `STARTER`, `GROWTH`, or `BUSINESS` |
| `400` | `TIER_CHANGE_NO_OP` | `tier` matches your subscription's current tier |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `NOT_FOUND` | Tenant could not be resolved (should not normally happen for an authenticated request) |
| `409` | `NO_ACTIVE_SUBSCRIPTION` | You have no `ACTIVE` subscription — promote with a paid tier and complete that payment review first |
| `409` | `TIER_CHANGE_ALREADY_PENDING` | A downgrade is already scheduled, or an upgrade payment is already in flight, for this subscription |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |
