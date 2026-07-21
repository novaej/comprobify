# Create Subscription

Starts a paid subscription for the authenticated tenant.

```
POST /v1/subscriptions
```

Unlike requesting a `tier` on [Promote Tenant](promote-tenant.md), this works **while the tenant is still in sandbox** — you don't need to promote to production first to start paying for a tier. It also works after promotion, for a tenant that promoted on FREE and wants to upgrade later.

## Authentication

`Authorization: Bearer <api-key>`

The tenant's email must be ACTIVE (verified) — same gate `POST /v1/tenants/promote` uses, since paying requires a verified address on file.

## Request body

```json
{
  "tier": "STARTER",
  "billingInterval": "MONTHLY"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `tier` | string | Yes | `STARTER`, `GROWTH`, or `BUSINESS` — see [Get Tiers](get-tiers.md) |
| `billingInterval` | string | No | `MONTHLY` (default) or `YEARLY` (2 months free) |

## What happens next

Same manual proof/review pipeline as the rest of the subscription system: upload proof of the SPI transfer via [`PATCH /v1/payments/:id/proof`](submit-payment-proof.md), the provider reviews it and links the self-billed invoice, and the tier/quota lands once that invoice is SRI-authorized. Poll [`GET /v1/subscriptions/me`](get-my-subscriptions.md) for status.

The tier/quota grant itself does not depend on the tenant's sandbox status — it can land while still in sandbox. It only matters for production document quota enforcement, so granting it early has no effect until the tenant promotes.

If the subscription becomes `ACTIVE` before promotion happens, [`POST /v1/tenants/promote`](promote-tenant.md) detects it automatically and skips tier selection entirely — any `tier`/`billingInterval` passed to that call is ignored, and the response surfaces the existing subscription instead of starting a new one.

## Response

**201 Created**

```json
{
  "ok": true,
  "subscription": { "id": "00000000-0000-0000-0000-000000000012", "tier": "STARTER", "status": "PENDING_PAYMENT", "billing_interval": "MONTHLY" },
  "payment": { "id": "00000000-0000-0000-0000-000000000018", "status": "PENDING", "amount": "17.39", "iva_rate": "0.1500", "iva_amount": "2.61", "total_amount": "20.00" },
  "bankTransfer": { "bankName": "...", "accountType": "...", "accountNumber": "...", "accountHolder": "...", "identification": "..." }
}
```

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `INVALID_TIER` | `tier` is not `STARTER`, `GROWTH`, or `BUSINESS` |
| `400` | `VALIDATION_FAILED` | `billingInterval` is not a recognised value |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `FORBIDDEN` (`EMAIL_VERIFICATION_REQUIRED`) | Tenant email not yet verified |
| `404` | `NOT_FOUND` | Tenant could not be resolved (should not normally happen for an authenticated request) |
| `409` | `SUBSCRIPTION_ALREADY_IN_FLIGHT` | The tenant already has a subscription in progress |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |
