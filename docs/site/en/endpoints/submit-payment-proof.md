# Submit Payment Proof

Uploads proof of an SPI bank transfer for a pending subscription payment — a screenshot, PDF, or photo of the transfer receipt. Accepts up to 5 files per request; call it again any time to add more (nothing already uploaded is ever overwritten).

```
PATCH /v1/payments/:id/proof
```

## Authentication

`Authorization: Bearer <api-key>`

The payment must belong to a subscription owned by your tenant. This is your own API key — not the admin secret.

## When to call this

After requesting a paid tier — either via [`POST /v1/subscriptions`](create-subscription.md) or [`POST /v1/tenants/promote`](promote-tenant.md) (`tier`/`billingInterval` fields), or having your provider start one via the admin API — the response includes a `payment` and `bankTransfer` instructions. Send the SPI transfer for `payment.total_amount` (the IVA-inclusive all-in amount), then call this endpoint with proof of it. The same flow also covers a renewal — about 7 days before your subscription's `current_period_end` you'll get a `SUBSCRIPTION_RENEWAL_DUE` notification and email with a fresh `payment.id` to submit proof against (see [Notifications](notifications.md)).

## Request body

`multipart/form-data`.

| Field | Type | Required | Description |
|---|---|---|---|
| `proof` | file (repeat the field for more than one) | Yes | PNG, JPEG, GIF, or PDF. Max 2 MB per file, up to 5 files per request. |
| `referenceNumber` | string | Yes | The reference/confirmation number your bank gave you for the SPI transfer. Max 50 characters. Applied to every file in this request — if you're resubmitting after a rejection with a new transfer, send the new transfer's reference number. |

> **Tip:** when you make the SPI transfer itself, put this payment's `payment.id` in the transfer's own description/reference field at your bank (e.g. "Comprobify payment 18") — we don't generate any other order number, so this is the easiest way for your provider to match the transfer to your payment when they review it. Not all banks support a description field, so this isn't required, but it's the single most useful thing you can do to speed up review.

## Response

**200 OK**

```json
{
  "ok": true,
  "payment": {
    "id": "00000000-0000-0000-0000-000000000018",
    "subscription_id": 12,
    "status": "REPORTED",
    "amount": "17.39",
    "iva_rate": "0.1500",
    "iva_amount": "2.61",
    "total_amount": "20.00",
    "method": "SPI_TRANSFER",
    "reported_at": "2026-06-28T23:14:03.087Z"
  },
  "proofs": [
    {
      "id": "00000000-0000-0000-0000-000000000042",
      "filename": "receipt.pdf",
      "mimeType": "application/pdf",
      "referenceNumber": "SPI-20260628-00931",
      "active": true,
      "createdAt": "2026-06-28T23:14:03.087Z"
    }
  ]
}
```

`proofs` lists only the file(s) uploaded **in this request** — call [List Payment Proofs](list-payment-proofs.md) for the full set uploaded so far (this payment may already have others from an earlier attempt). The raw file bytes are never echoed back, only metadata; use [Download Payment Proof](download-payment-proof.md) with a `proofId` from this response to fetch them again. `status` moves to `REPORTED`. Your provider reviews the files and verifies or rejects the payment; once verified, they self-bill the invoice and the subscription activates automatically once SRI authorizes it. Once a payment is `VERIFIED`, no further uploads (or deletes) are accepted for it — everything about its proof is locked in at that point.

## What happens next

You'll get a `PAYMENT_VERIFIED` or `PAYMENT_REJECTED` notification and email as soon as your provider records their decision (see [Notifications](notifications.md)) — no need to poll, though [`GET /v1/subscriptions/me`](get-my-subscriptions.md) (in-between states and any rejection reason) and [`GET /v1/tenants/me`](tenant-me.md) (resulting tier/quota once it lands) are always available too.

**If your proof is rejected**, the email explains why in plain language, and `GET /v1/subscriptions/me` shows the same reason as a stable `rejection_reason_code` (one of `AMOUNT_MISMATCH`, `TRANSFER_NOT_FOUND`, `WRONG_ACCOUNT`, `ILLEGIBLE_PROOF`, `DUPLICATE_SUBMISSION`, `OTHER`) for your own UI to map to a message. Once you've fixed whatever it flagged, call this same endpoint again with new proof for the same payment — the files from the rejected attempt stay right where they are (see [List Payment Proofs](list-payment-proofs.md) and [Delete Payment Proof](delete-payment-proof.md) if you want to remove one), you're just adding more. Rejection isn't a dead end; only an already-`VERIFIED` payment refuses further uploads.

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `INVALID_FILE_UPLOAD` | No file was sent, a file isn't PNG/JPEG/GIF/PDF, or a file exceeds 2 MB |
| `400` | `VALIDATION_FAILED` | `referenceNumber` was missing, blank, or over 50 characters |
| `400` | `PROOF_FILE_LIMIT_REACHED` | This payment already has the maximum number of active proof files (10 total, across every upload attempt) — delete one first via [Delete Payment Proof](delete-payment-proof.md) |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `PAYMENT_NOT_FOUND` | Payment doesn't exist, or belongs to a different tenant |
| `409` | `CONFLICT` | The payment was already `VERIFIED` and can no longer accept new proof |
