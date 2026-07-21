# Get My Subscriptions

Returns your full subscription history, newest first, with each subscription's payments nested.

```
GET /v1/subscriptions/me
```

## Authentication

`Authorization: Bearer <api-key>`

## When to call this

A payment review (verified/rejected) and the renewal reminder/expiry both fire a [notification](notifications.md) and email — you don't strictly need to poll. But there's still no notification for the moment a subscription's invoice gets authorized and activates (only the payment decision that preceded it fired one) — after [requesting a paid tier](promote-tenant.md) and [submitting payment proof](submit-payment-proof.md), poll this endpoint (or [`GET /v1/tenants/me`](tenant-me.md) for just the resulting tier/quota) to see what's happening in between, including why a payment was rejected, if it was.

## Response

**200 OK**

```json
{
  "ok": true,
  "subscriptions": [
    {
      "id": "00000000-0000-0000-0000-000000000012",
      "tenant_id": 4,
      "tier": "STARTER",
      "billing_interval": "MONTHLY",
      "status": "PENDING_PAYMENT",
      "initial_invoice_document_id": null,
      "current_period_start": null,
      "current_period_end": null,
      "created_at": "2026-06-29T04:45:40.225Z",
      "canceled_at": null,
      "payments": [
        {
          "id": "00000000-0000-0000-0000-000000000018",
          "status": "REJECTED",
          "amount": "17.39",
          "iva_rate": "0.1500",
          "iva_amount": "2.61",
          "total_amount": "20.00",
          "method": "SPI_TRANSFER",
          "rejection_reason_code": "TRANSFER_NOT_FOUND",
          "reported_at": "2026-06-29T04:45:40.278Z",
          "verified_at": null
        }
      ]
    }
  ]
}
```

Proof files themselves are never inlined here — call [List Payment Proofs](list-payment-proofs.md) for a payment to see what's been uploaded, or [Download Payment Proof](download-payment-proof.md) for a specific file. `rejection_reason_code` is only present on `REJECTED` payments, and is cleared automatically once you [re-submit proof](submit-payment-proof.md) for that payment. It's one of a predefined set of codes (`AMOUNT_MISMATCH`, `TRANSFER_NOT_FOUND`, `WRONG_ACCOUNT`, `ILLEGIBLE_PROOF`, `DUPLICATE_SUBMISSION`, `OTHER`) — map it to your own UI message rather than displaying the raw code, the same way you'd handle an [error `code`](../errors/index.md). `amount` is the pre-IVA base (base imponible); `total_amount` is what was actually transferred via SPI.

## Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- Returns an empty array if you've never had a subscription (e.g. still on FREE).
- A `REJECTED` payment isn't a dead end — submit new proof for the *same* payment via `PATCH /v1/payments/:id/proof` using the `id` from this response.
