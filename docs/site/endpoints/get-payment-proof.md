# Get Payment Proof

Downloads the proof-of-transfer file you previously uploaded for a payment.

```
GET /v1/payments/:id/proof
```

## Authentication

`Authorization: Bearer <api-key>`

The payment must belong to a subscription owned by your tenant. Only the tenant who uploaded the file can retrieve it — the API enforces this via the subscription join.

## Path parameters

| Parameter | Description |
|---|---|
| `id` | The payment ID (from the `payment.id` field in the subscription or proof-upload response) |

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
| `404` | `NOT_FOUND` | Payment doesn't exist, belongs to a different tenant, or no proof has been uploaded yet |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |
