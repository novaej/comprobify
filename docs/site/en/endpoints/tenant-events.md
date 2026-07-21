# Get Tenant Events

Returns your full tenant-level audit trail — email verification, subscription, payment, and tier/billing-interval change lifecycle events — in chronological order (oldest first).

```
GET /v1/tenants/events
```

## Authentication

`Authorization: Bearer <api-key>`

## When to call this

This is the one place that shows the full sequence of changes to your subscription over time — e.g. that it started as a monthly GROWTH subscription and later changed to yearly STARTER. [`GET /v1/subscriptions/me`](get-my-subscriptions.md) and [`GET /v1/tenants/me`](tenant-me.md) only show *current* state; this endpoint shows how you got there.

## Response

**200 OK**

```json
{
  "ok": true,
  "events": [
    {
      "id": "00000000-0000-0000-0000-000000000101",
      "eventType": "EMAIL_VERIFIED",
      "detail": null,
      "createdAt": "2026-06-01T10:00:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000118",
      "eventType": "SUBSCRIPTION_CREATED",
      "detail": { "subscriptionId": "00000000-0000-0000-0000-000000000012", "tier": "GROWTH", "billingInterval": "MONTHLY" },
      "createdAt": "2026-06-01T10:05:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000119",
      "eventType": "SUBSCRIPTION_ACTIVATED",
      "detail": { "subscriptionId": "00000000-0000-0000-0000-000000000012", "tier": "GROWTH" },
      "createdAt": "2026-06-01T10:20:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000205",
      "eventType": "TIER_CHANGE_REQUESTED",
      "detail": {
        "subscriptionId": "00000000-0000-0000-0000-000000000012",
        "fromTier": "GROWTH",
        "toTier": "STARTER",
        "fromBillingInterval": "MONTHLY",
        "toBillingInterval": "YEARLY",
        "totalAmount": 200,
        "effectiveAt": "2026-07-01T10:20:00.000Z"
      },
      "createdAt": "2026-06-25T09:00:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000212",
      "eventType": "TIER_CHANGE_SCHEDULED",
      "detail": {
        "subscriptionId": "00000000-0000-0000-0000-000000000012",
        "fromTier": "GROWTH",
        "toTier": "STARTER",
        "fromBillingInterval": "MONTHLY",
        "toBillingInterval": "YEARLY",
        "effectiveAt": "2026-07-01T10:20:00.000Z",
        "paymentId": "00000000-0000-0000-0000-000000000040"
      },
      "createdAt": "2026-06-27T14:10:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000230",
      "eventType": "TIER_CHANGED",
      "detail": {
        "subscriptionId": "00000000-0000-0000-0000-000000000012",
        "fromTier": "GROWTH",
        "toTier": "STARTER",
        "fromBillingInterval": "MONTHLY",
        "toBillingInterval": "YEARLY"
      },
      "createdAt": "2026-07-01T10:20:00.000Z"
    }
  ]
}
```

`detail` is a free-form object specific to each `eventType` (or `null` for events with no extra context) — the fields shown above match what each event type currently carries, but treat unfamiliar fields as forward-compatible additions rather than a fixed schema.

### Event types

| Event | Meaning |
|---|---|
| `VERIFICATION_EMAIL_SENT` / `VERIFICATION_EMAIL_FAILED` / `VERIFICATION_EMAIL_DELIVERED` / `VERIFICATION_EMAIL_TEMP_FAILED` / `VERIFICATION_EMAIL_COMPLAINED` | Registration verification email delivery status |
| `EMAIL_VERIFIED` | Tenant's email was verified |
| `SUBSCRIPTION_CREATED` | A subscription was started (`POST /v1/subscriptions` or at promotion) |
| `PAYMENT_REPORTED` | Proof of transfer was submitted for a payment |
| `PAYMENT_VERIFIED` / `PAYMENT_REJECTED` | Provider reviewed a payment's proof |
| `INVOICE_LINKED` | A self-billed invoice was linked to a subscription or payment |
| `SUBSCRIPTION_ACTIVATED` | Subscription reached `ACTIVE` (first billing period opened) |
| `TIER_CHANGE_REQUESTED` | [Change Tier](change-tier.md) created a payment (same-interval upgrade, or any billing-interval change) |
| `TIER_CHANGE_SCHEDULED` | A tier/interval change was scheduled to apply at `current_period_end` — either a free same-interval downgrade (immediately, at request time) or a paid billing-interval change (once its payment's invoice authorizes) |
| `TIER_CHANGED` | A tier and/or billing-interval change actually took effect |
| `SUBSCRIPTION_CANCELLATION_SCHEDULED` | [`DELETE /v1/subscriptions`](cancel-subscription.md) scheduled an end-of-period cancellation |
| `SUBSCRIPTION_CANCELLED` | Subscription reached `CANCELLED` (scheduled cancellation applied, or admin override) |
| `RENEWAL_DUE` | A renewal payment was opened ahead of `current_period_end` |
| `SUBSCRIPTION_RENEWED` | A renewal payment's invoice authorized, extending the billing period |
| `SUBSCRIPTION_EXPIRED` | Subscription ran past its renewal grace period with no payment and was downgraded to FREE |

## Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `NOT_FOUND` | Tenant could not be resolved (should not normally happen for an authenticated request) |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- Returns an empty array if nothing has happened yet beyond registration.
- Not paginated — the full history is returned every time. Fine for typical tenant lifetime volume; if this ever needs pagination, `?sinceId=` (mirroring [Notifications](notifications.md)) would be the natural addition.
