# List Payment Proofs

Returns the metadata (not the file bytes) for every proof file you've uploaded for a payment that's still active — i.e. hasn't been deleted.

```
GET /v1/payments/:id/proofs
```

## Authentication

`Authorization: Bearer <api-key>`

The payment must belong to a subscription owned by your tenant.

## Path parameters

| Parameter | Description |
|---|---|
| `id` | The payment ID |

## Response

**200 OK**

```json
{
  "ok": true,
  "proofs": [
    {
      "id": "00000000-0000-0000-0000-000000000042",
      "filename": "receipt.pdf",
      "mimeType": "application/pdf",
      "referenceNumber": "SPI-20260628-00931",
      "active": true,
      "createdAt": "2026-06-28T23:14:03.087Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000043",
      "filename": "bank-statement.png",
      "mimeType": "image/png",
      "referenceNumber": "SPI-20260628-00931",
      "active": true,
      "createdAt": "2026-06-29T10:02:11.400Z"
    }
  ]
}
```

Only `active: true` files are returned here — a file you've [deleted](delete-payment-proof.md) drops out of this list (though it isn't gone from your provider's view; see that page). Use a proof's `id` with [Download Payment Proof](download-payment-proof.md) to fetch the actual file. `referenceNumber` is the bank transfer reference you supplied when uploading — every file from the same [submission](submit-payment-proof.md) shares the same value; a later resubmission (e.g. after a rejection) can carry a different one if you sent a new transfer.

## Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `PAYMENT_NOT_FOUND` | Payment doesn't exist, or belongs to a different tenant |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |
