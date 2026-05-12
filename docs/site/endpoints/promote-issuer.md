# Promote Issuer to Production

Promotes a sandbox issuer to production. Sequential counters are seeded for every active document type (using `initialSequentials` overrides if provided, otherwise starting at 1). If the tenant does not already have an active production API key, one is minted and returned.

```
POST /api/issuers/:id/promote
```

This is a **one-way** action. Once an issuer is in production, it cannot return to sandbox.

## Authentication

`Authorization: Bearer <api-key>`

The tenant's email must be ACTIVE (verified) — promotion is blocked for PENDING_VERIFICATION tenants.

## Path parameters

| Parameter | Description |
|---|---|
| `id` | Numeric issuer id (from `GET /api/issuers`) |

## Request body

```json
{
  "initialSequentials": [
    { "documentType": "01", "sequential": 1 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `initialSequentials` | array | No | Per-document-type starting sequential numbers. Any missing type defaults to `1`. |
| `initialSequentials[].documentType` | string | Yes (per entry) | Document type code, e.g. `"01"` |
| `initialSequentials[].sequential` | integer | Yes (per entry) | Next sequential number to issue (≥ 1) |

## Response

**200 OK**

```json
{
  "ok": true,
  "issuer": {
    "id": 42,
    "ruc": "1791234567001",
    "businessName": "ACME S.A.",
    "branchCode": "001",
    "issuePointCode": "001",
    "sandbox": false,
    "certFingerprint": "...",
    "certExpiry": "2027-03-15T00:00:00.000Z"
  },
  "apiKey": "a3f8c2bd..."
}
```

`apiKey` is `null` if the tenant already has at least one active production key. When non-null, store it immediately — it is shown only once.

Sandbox keys are **not** automatically revoked. They keep working with any of the tenant's remaining sandbox issuers and can be revoked manually via [`DELETE /api/keys/:id`](api-keys.md#revoke-a-key) if no longer needed.

## Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `FORBIDDEN` | Tenant email not verified, or issuer belongs to a different tenant |
| `404` | `NOT_FOUND` | Issuer id does not exist |
| `409` | `CONFLICT` | Issuer is already in production |
