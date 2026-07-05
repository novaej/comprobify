# Delete Payment Proof

Removes one proof file from your own view — e.g. you uploaded the wrong file by mistake. This is a **soft** delete: your provider can still see and download it for their records, it just drops out of your own [List Payment Proofs](list-payment-proofs.md) and can no longer be [downloaded](download-payment-proof.md) through your own API key.

```
DELETE /v1/payments/:id/proofs/:proofId
```

## Authentication

`Authorization: Bearer <api-key>`

The payment must belong to a subscription owned by your tenant.

## Path parameters

| Parameter | Description |
|---|---|
| `id` | The payment ID |
| `proofId` | The proof file's `id`, from [List Payment Proofs](list-payment-proofs.md) |

## Response

**200 OK**

```json
{ "ok": true }
```

## Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `404` | `PAYMENT_NOT_FOUND` | Payment doesn't exist, or belongs to a different tenant |
| `404` | `NOT_FOUND` | The proof doesn't belong to this payment, or is already deleted |
| `409` | `CONFLICT` | The payment is already `VERIFIED` — its proof files can no longer be changed |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- The [cumulative 10-file limit](submit-payment-proof.md) enforced on upload only counts *active* files — deleting one frees up room for another upload.
