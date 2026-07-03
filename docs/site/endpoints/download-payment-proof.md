# Download Payment Proof

Downloads one specific proof-of-transfer file you previously uploaded for a payment.

```
GET /v1/payments/:id/proofs/:proofId
```

## Authentication

`Authorization: Bearer <api-key>`

The payment must belong to a subscription owned by your tenant, and the file must still be active — a [deleted](delete-payment-proof.md) file is no longer downloadable through this endpoint (your provider can still see and download it on their side, for audit purposes).

## Path parameters

| Parameter | Description |
|---|---|
| `id` | The payment ID |
| `proofId` | The proof file's `id`, from [List Payment Proofs](list-payment-proofs.md) or the [Submit Payment Proof](submit-payment-proof.md) response |

## Response

**200 OK** — the raw file, streamed directly.

| Header | Value |
|---|---|
| `Content-Type` | The MIME type of the uploaded file (`image/png`, `image/jpeg`, `image/gif`, or `application/pdf`) |
| `Content-Disposition` | `inline; filename="<original filename>"` |

## Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `NOT_FOUND` | Payment doesn't exist, belongs to a different tenant, the proof doesn't belong to this payment, or it's been deleted |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |
