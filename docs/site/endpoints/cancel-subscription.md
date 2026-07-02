# Cancel Subscription

Schedules a cancellation at the end of the current billing period. No refund is issued — the subscription keeps running at the current tier until `current_period_end`, then the tenant is dropped to FREE and the subscription is closed.

```
DELETE /v1/subscriptions
```

## Authentication

`Authorization: Bearer <api-key>`

Requires an `ACTIVE` subscription. If you want to move to a lower **paid** tier instead of cancelling entirely, use [`POST /v1/subscriptions/change-tier`](change-tier.md).

## How it works

Calling this endpoint sets `pending_tier = 'FREE'` on your active subscription and returns immediately — it does **not** cancel access on the spot. The subscription continues as normal until `current_period_end`. The provider's daily scheduled job (`POST /v1/admin/jobs/subscriptions`) then applies the cancellation: your tier drops to FREE, your `document_quota` resets to the FREE allowance, and the subscription status becomes `CANCELLED`.

There is no refund for the remaining time in the current period.

## Request body

None.

## Response

**200 OK**

```json
{
  "ok": true,
  "subscription": {
    "id": 12,
    "tenant_id": 4,
    "tier": "STARTER",
    "billing_interval": "MONTHLY",
    "status": "ACTIVE",
    "pending_tier": "FREE",
    "current_period_start": "2026-06-15T00:00:00.000Z",
    "current_period_end": "2026-07-15T00:00:00.000Z"
  },
  "effectiveAt": "2026-07-15T00:00:00.000Z"
}
```

`effectiveAt` is the `current_period_end` at which the cancellation will be applied. Your subscription's `pending_tier` field will read `"FREE"` until then.

## What happens next

There is no notification when the cancellation is applied — poll [`GET /v1/subscriptions/me`](get-my-subscriptions.md) to confirm the status flipped to `CANCELLED`, or [`GET /v1/tenants/me`](tenant-me.md) to confirm your tier and quota dropped to the FREE values.

No renewal reminder will be issued for a pending-cancellation subscription.

## Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `409` | `NO_ACTIVE_SUBSCRIPTION` | You have no `ACTIVE` subscription to cancel |
| `409` | `CANCELLATION_ALREADY_PENDING` | A cancellation is already scheduled for this subscription |
| `409` | `TIER_CHANGE_ALREADY_PENDING` | A paid-tier downgrade is already scheduled, or an upgrade payment is already in flight — resolve it first |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |
