# Promote Tenant to Production

Promotes the authenticated tenant from sandbox to production. All branches (issuers) are promoted at once. Sequential counters are seeded for every issuer × document type combination. All active sandbox API keys are revoked and replaced with matching production keys — one per revoked sandbox key, preserving the same label.

```
POST /v1/tenants/promote
```

This is a **one-way** action. Once a tenant is in production, it cannot return to sandbox.

## Authentication

`Authorization: Bearer <api-key>`

The tenant's email must be ACTIVE (verified) and all agreements must be ACCEPTED — promotion is blocked if either condition is not met.

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
| `tier` | string | No | `STARTER`, `GROWTH`, or `BUSINESS` — see [Get Tiers](get-tiers.md). Omit to stay on FREE in production; promotion never waits on payment either way. Ignored if the tenant already has a subscription in progress (see below). |
| `billingInterval` | string | No | `MONTHLY` (default) or `YEARLY` (2 months free). Ignored if `tier` is omitted or if it's ignored per the above. |

Requesting a `tier` here starts the subscription/payment pipeline (same as the admin-driven path) — see [Submit Payment Proof](submit-payment-proof.md) for what happens next. The tier/quota upgrade itself only lands once that subscription is paid and its self-billed invoice is SRI-authorized; it does not happen as part of this call.

If the tenant already started a subscription before promoting — via [`POST /v1/subscriptions`](create-subscription.md), which works while still in sandbox — and it's still in progress by the time this call happens (any status other than `CANCELLED`/`EXPIRED`: `PENDING_PAYMENT`, `PAYMENT_RECEIVED`, `INVOICE_PROCESSING`, or `ACTIVE`), there's nothing left to select: `tier`/`billingInterval` are ignored entirely, and the response surfaces that existing subscription instead of starting a new one. This is a hard block, not just a courtesy — it prevents a second subscription/payment from being opened while one is already awaiting proof, review, or invoice authorization.

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
  "payment": { "id": 18, "status": "PENDING", "amount": "17.39", "iva_rate": "0.1500", "iva_amount": "2.61", "total_amount": "20.00" },
  "bankTransfer": { "bankName": "...", "accountType": "...", "accountNumber": "...", "accountHolder": "...", "identification": "..." }
}
```

`apiKeys` contains one entry per sandbox key that was active at the time of promotion. **Store all tokens immediately — they are shown only once.** Distribute each token to the integration that previously used the sandbox key with the same label.

`subscription`, `payment`, and `bankTransfer` are only present if `tier` was supplied and a new subscription was started. If the tenant already had a subscription in progress going into this call (any status other than `CANCELLED`/`EXPIRED`), only `subscription` is present (no `payment`/`bankTransfer` — nothing new was created). Use `bankTransfer` to show the tenant where to send the SPI transfer, then submit proof of it — see [Submit Payment Proof](submit-payment-proof.md).

Sandbox keys are revoked automatically during promotion. If you had no sandbox keys, `apiKeys` will be an empty array — mint production keys via [`POST /v1/keys`](api-keys.md#mint-a-key).

**Subscription period reset:** if the tenant already has an `ACTIVE` subscription (paid while still in sandbox), the billing period (`current_period_start`/`current_period_end`) is automatically reset to the promotion date. This ensures the paid period counts production usage time rather than sandbox testing time.

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `tier` or `billingInterval` is not a recognised value |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `FORBIDDEN` | Tenant email not yet verified (status `PENDING_VERIFICATION`) |
| `403` | `AGREEMENT_ACCEPTANCE_REQUIRED` | One or more agreements have not been accepted — call `GET /v1/tenants/agreements` to see which ones, view them at `GET /v1/tenants/agreements/:type`, then accept via `POST /v1/tenants/agreements` |
| `409` | `CONFLICT` | Tenant is already in production |
