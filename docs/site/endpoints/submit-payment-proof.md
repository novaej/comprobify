# Submit Payment Proof

Uploads proof of an SPI bank transfer for a pending subscription payment — a screenshot, PDF, or photo of the transfer receipt.

```
PATCH /v1/payments/:id/proof
```

## Authentication

`Authorization: Bearer <api-key>`

The payment must belong to a subscription owned by your tenant. This is your own API key — not the admin secret.

## When to call this

After requesting a paid tier — either via [`POST /v1/tenants/promote`](promote-tenant.md) (`tier`/`billingInterval` fields) or having your provider start one via the admin API — the response includes a `payment` and `bankTransfer` instructions. Send the SPI transfer for the amount shown, then call this endpoint with proof of it.

## Request body

`multipart/form-data`.

| Field | Type | Required | Description |
|---|---|---|---|
| `proof` | file | Yes | PNG, JPEG, GIF, or PDF. Max 2 MB. |

## Response

**200 OK**

```json
{
  "ok": true,
  "payment": {
    "id": 18,
    "subscription_id": 12,
    "status": "REPORTED",
    "amount": "19.00",
    "method": "SPI_TRANSFER",
    "reported_at": "2026-06-28T23:14:03.087Z",
    "proof_filename": "receipt.pdf",
    "proof_mime_type": "application/pdf"
  }
}
```

The raw file is never echoed back — only its filename and content type. `status` moves to `REPORTED`. Your provider reviews the file and verifies or rejects the payment; once verified, they self-bill the invoice and the subscription activates automatically once SRI authorizes it.

## What happens next

There's no notification when this completes — poll [`GET /v1/tenants/me`](tenant-me.md) periodically and watch for `subscriptionTier`/`documentQuota` to update. If your proof is rejected, you'll need to submit a new one (talk to your provider about why).

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `INVALID_FILE_UPLOAD` | No file was sent, or it isn't PNG/JPEG/GIF/PDF, or exceeds 2 MB |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `PAYMENT_NOT_FOUND` | Payment doesn't exist, or belongs to a different tenant |
| `409` | `CONFLICT` | The payment was already `VERIFIED` or `REJECTED` and can no longer accept new proof |
