# Promote Tenant to Production

Promotes the authenticated tenant from sandbox to production. All branches (issuers) are promoted at once. Sequential counters are seeded for every issuer × document type combination. All active sandbox API keys are revoked and replaced with matching production keys — one per revoked sandbox key, preserving the same label.

```
POST /v1/tenants/promote
```

This is a **one-way** action. Once a tenant is in production, it cannot return to sandbox.

## Authentication

`Authorization: Bearer <api-key>`

The tenant's email must be ACTIVE (verified) and all legal documents must be ACCEPTED — promotion is blocked if either condition is not met.

## Request body

All fields are optional. An empty body `{}` is valid.

```json
{
  "initialSequentials": [
    { "issuerId": 1, "documentType": "01", "sequential": 1 },
    { "issuerId": 2, "documentType": "01", "sequential": 1 }
  ],
  "tier": "STARTER",
  "billingInterval": "MONTHLY"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `initialSequentials` | array | No | Per-issuer, per-document-type starting sequential numbers. Any combination not listed defaults to `1`. |
| `initialSequentials[].issuerId` | integer | Yes (per entry) | Numeric issuer id (from `GET /v1/issuers`) |
| `initialSequentials[].documentType` | string | Yes (per entry) | Document type code, e.g. `"01"` |
| `initialSequentials[].sequential` | integer | Yes (per entry) | Next sequential number to issue (≥ 1) |
| `tier` | string | No | `STARTER`, `GROWTH`, or `BUSINESS` — see [Get Tiers](get-tiers.md). Omit to stay on FREE in production; promotion never waits on payment either way. Ignored if the tenant already has an `ACTIVE` subscription (see below). |
| `billingInterval` | string | No | `MONTHLY` (default) or `YEARLY` (2 months free). Ignored if `tier` is omitted or if it's ignored per the above. |

Requesting a `tier` here starts the subscription/payment pipeline (same as the admin-driven path) — see [Submit Payment Proof](submit-payment-proof.md) for what happens next. The tier/quota upgrade itself only lands once that subscription is paid and its self-billed invoice is SRI-authorized; it does not happen as part of this call.

If the tenant already started a subscription before promoting — via [`POST /v1/subscriptions`](create-subscription.md), which works while still in sandbox — and it's already `ACTIVE` by the time this call happens, there's nothing left to select: `tier`/`billingInterval` are ignored entirely, and the response surfaces that existing subscription instead of starting a new one.

## Response

**200 OK**

```json
{
  "ok": true,
  "apiKeys": [
    { "label": "Initial sandbox key", "apiKey": "a3f8c2bd..." },
    { "label": "erp-integration",     "apiKey": "d94e17ac..." }
  ],
  "subscription": { "id": 12, "tier": "STARTER", "status": "PENDING_PAYMENT", "billing_interval": "MONTHLY" },
  "payment": { "id": 18, "status": "PENDING", "amount": "19.00" },
  "bankTransfer": { "bankName": "...", "accountType": "...", "accountNumber": "...", "accountHolder": "...", "identification": "..." }
}
```

`apiKeys` contains one entry per sandbox key that was active at the time of promotion. **Store all tokens immediately — they are shown only once.** Distribute each token to the integration that previously used the sandbox key with the same label.

`subscription`, `payment`, and `bankTransfer` are only present if `tier` was supplied and a new subscription was started. If the tenant already had an `ACTIVE` subscription going into this call, only `subscription` is present (no `payment`/`bankTransfer` — nothing new was created). Use `bankTransfer` to show the tenant where to send the SPI transfer, then submit proof of it — see [Submit Payment Proof](submit-payment-proof.md).

Sandbox keys are revoked automatically during promotion. If you had no sandbox keys, `apiKeys` will be an empty array — mint production keys via [`POST /v1/keys`](api-keys.md#mint-a-key).

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `tier` or `billingInterval` is not a recognised value |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `FORBIDDEN` | Tenant email not yet verified (status `PENDING_VERIFICATION`) |
| `403` | `LEGAL_ACCEPTANCE_REQUIRED` | One or more legal documents have not been accepted — call `GET /v1/tenants/legal-acceptance` to see which ones, view them at `GET /v1/tenants/legal-documents/:type`, then accept via `POST /v1/tenants/legal-acceptance` |
| `409` | `CONFLICT` | Tenant is already in production |
| `409` | `SUBSCRIPTION_ALREADY_IN_FLIGHT` | A `tier` was requested but the tenant already has a subscription in progress |
