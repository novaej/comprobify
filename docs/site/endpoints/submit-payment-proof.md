# Submit Payment Proof

Uploads proof of an SPI bank transfer for a pending subscription payment — a screenshot, PDF, or photo of the transfer receipt.

```
PATCH /v1/payments/:id/proof
```

## Authentication

`Authorization: Bearer <api-key>`

The payment must belong to a subscription owned by your tenant. This is your own API key — not the admin secret.

## When to call this

After requesting a paid tier — either via [`POST /v1/subscriptions`](create-subscription.md) or [`POST /v1/tenants/promote`](promote-tenant.md) (`tier`/`billingInterval` fields), or having your provider start one via the admin API — the response includes a `payment` and `bankTransfer` instructions. Send the SPI transfer for the amount shown, then call this endpoint with proof of it. The same flow also covers a renewal — about 7 days before your subscription's `current_period_end` you'll get a `SUBSCRIPTION_RENEWAL_DUE` notification and email with a fresh `payment.id` to submit proof against (see [Notifications](notifications.md)).

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

You'll get a `PAYMENT_VERIFIED` or `PAYMENT_REJECTED` notification and email as soon as your provider records their decision (see [Notifications](notifications.md)) — no need to poll, though [`GET /v1/subscriptions/me`](get-my-subscriptions.md) (in-between states and any rejection reason) and [`GET /v1/tenants/me`](tenant-me.md) (resulting tier/quota once it lands) are always available too.

**If your proof is rejected**, the email and `GET /v1/subscriptions/me` both show a `rejection_reason` explaining why (e.g. "transfer not reflected yet"). Once you've fixed whatever it flagged, call this same endpoint again with new proof for the same payment — rejection isn't a dead end, only an already-`VERIFIED` payment refuses further uploads.

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `INVALID_FILE_UPLOAD` | No file was sent, or it isn't PNG/JPEG/GIF/PDF, or exceeds 2 MB |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `PAYMENT_NOT_FOUND` | Payment doesn't exist, or belongs to a different tenant |
| `409` | `CONFLICT` | The payment was already `VERIFIED` and can no longer accept new proof |
