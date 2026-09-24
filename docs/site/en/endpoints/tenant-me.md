# Get Current Tenant

Returns identity and account details for the tenant that owns the API key used to authenticate the request. Useful for a third-party app that already has an API key (e.g. one you minted from your dashboard) and needs to resolve the `tenant.id` UUID — for example, to link an existing API account in a frontend without re-entering the RUC or P12 certificate, or to match incoming webhook deliveries back to the right account.

```
GET /v1/tenants/me
```

## Authentication

`Authorization: Bearer <api-key>`

## Response

```json
{
  "ok": true,
  "tenant": {
    "id": "00000000-0000-0000-0000-000000000042",
    "email": "owner@example.com",
    "subscriptionTier": "GROWTH",
    "status": "ACTIVE",
    "suspensionReasonCode": null,
    "documentCount": 128,
    "documentQuota": 1000,
    "extraSeats": 2,
    "pendingExtraSeats": null,
    "sandbox": false,
    "agreementAcceptedAt": "2026-06-28T12:00:00.000Z",
    "agreementVersion": "2026-06-28"
  }
}
```

| Field | Description |
|---|---|
| `id` | Tenant UUID. Use this to correlate webhook deliveries and other tenant-scoped resources. |
| `email` | Tenant's registered email address. |
| `subscriptionTier` | `FREE`, `STARTER`, `GROWTH`, or `BUSINESS`. |
| `status` | `PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED`, or `PAST_DUE`. |
| `suspensionReasonCode` | Why the account is suspended: `PAYMENT_REVERSED`, `FRAUD_SUSPECTED`, `TERMS_VIOLATION`, `VOLUNTARY_CLOSURE`, `UNPAID_BALANCE`, or `OTHER`. `null` unless `status` is `SUSPENDED`. A stable code meant for your UI to map to its own localized copy — `VOLUNTARY_CLOSURE` is an account closure you requested, not a sanction. |
| `documentCount` | Documents issued in the current billing period. |
| `documentQuota` | Document limit for the current `subscriptionTier`. |
| `extraSeats` | Extra dashboard user seats purchased on top of the plan's included count (0 if none, or if there's no active subscription). Comprobify bills for this but does not enforce it — see [Your subscription & billing](../paying-your-subscription.md#extra-user-seats). |
| `pendingExtraSeats` | A scheduled seat count taking effect at the end of the current billing period (a decrease in progress), or `null` if nothing is scheduled. |
| `sandbox` | `true` if the tenant is in the SRI test environment, `false` if promoted to production. |
| `agreementAcceptedAt` | Timestamp of the most recent agreement acceptance event, or `null` if the tenant hasn't accepted any yet. |
| `agreementVersion` | The TERMS document version the tenant last accepted, or `null` if the tenant hasn't accepted any yet. |

## Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- No `X-Issuer-Id` header is required — this endpoint resolves the tenant, not an issuer.
- The response reflects exactly what the `authenticate` middleware already resolved from the API key — there is no separate database lookup, so any active key (sandbox or production) returns its tenant's current state.
- This does not return the list of issuers (branches) — use `GET /v1/issuers` for that.
- `suspensionReasonCode` tells you *why* the account was suspended without reading [`GET /v1/tenants/events`](tenant-events.md); the full history (including earlier suspensions already lifted) still lives there, in each `STATUS_CHANGED` event's `detail`.
- Unlike most authenticated endpoints, this one stays reachable even when `status` is `SUSPENDED` — it's one of a small set of read-only endpoints a suspended tenant can still use (see the `ACCOUNT_SUSPENDED` entry in the [error catalogue](../errors/index.md)). Polling this endpoint is a valid way to detect a suspension and check the account's current `status`.
- **This is also how you find out a paid-tier upgrade completed.** After requesting a tier at [promotion](../account-lifecycle.md#going-to-production) and [Your subscription & billing](../paying-your-subscription.md), you'll get a [notification](notifications.md) and email the moment your provider records a decision, and that decision *is* the activation: `subscriptionTier` and `documentQuota` already reflect the new tier by the time the `PAYMENT_VERIFIED` notification arrives. There is no later invoicing step to wait on. For the in-between states (pending, rejected, why) see [Your subscription & billing](../paying-your-subscription.md) instead — this endpoint only shows the end result.
