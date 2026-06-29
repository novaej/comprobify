# Get My Subscriptions

Returns your full subscription history, newest first, with each subscription's payments nested.

```
GET /v1/subscriptions/me
```

## Authentication

`Authorization: Bearer <api-key>`

## When to call this

There's no notification when a payment review or a subscription activation completes. After [requesting a paid tier](promote-tenant.md) and [submitting payment proof](submit-payment-proof.md), poll this endpoint (or [`GET /v1/tenants/me`](tenant-me.md) for just the resulting tier/quota) to see what's happening in between — including why a payment was rejected, if it was.

## Response

**200 OK**

```json
{
  "ok": true,
  "subscriptions": [
    {
      "id": 12,
      "tenant_id": 4,
      "tier": "STARTER",
      "billing_interval": "MONTHLY",
      "status": "PENDING_PAYMENT",
      "invoice_document_id": null,
      "current_period_start": null,
      "current_period_end": null,
      "created_at": "2026-06-29T04:45:40.225Z",
      "canceled_at": null,
      "payments": [
        {
          "id": 18,
          "status": "REJECTED",
          "amount": "19.00",
          "method": "SPI_TRANSFER",
          "rejection_reason": "Transfer not reflected in our account yet — please check the amount and resend",
          "proof_filename": "receipt.pdf",
          "proof_mime_type": "application/pdf",
          "reported_at": "2026-06-29T04:45:40.278Z",
          "verified_at": null
        }
      ]
    }
  ]
}
```

The raw proof file is never included — only its filename and content type. `rejection_reason` is only present on `REJECTED` payments, and is cleared automatically once you [re-submit proof](submit-payment-proof.md) for that payment.

## Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- Returns an empty array if you've never had a subscription (e.g. still on FREE).
- A `REJECTED` payment isn't a dead end — submit new proof for the *same* payment via `PATCH /v1/payments/:id/proof` using the `id` from this response.
