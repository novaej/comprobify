# Promote Tenant to Production

Promotes the authenticated tenant from sandbox to production. All branches (issuers) are promoted at once. Sequential counters are seeded for every issuer × document type combination. All active sandbox API keys are revoked and replaced with matching production keys — one per revoked sandbox key, preserving the same label.

```
POST /api/tenants/promote
```

This is a **one-way** action. Once a tenant is in production, it cannot return to sandbox.

## Authentication

`Authorization: Bearer <api-key>`

The tenant's email must be ACTIVE (verified) — promotion is blocked for PENDING_VERIFICATION tenants.

## Request body

All fields are optional. An empty body `{}` is valid.

```json
{
  "initialSequentials": [
    { "issuerId": 1, "documentType": "01", "sequential": 1 },
    { "issuerId": 2, "documentType": "01", "sequential": 1 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `initialSequentials` | array | No | Per-issuer, per-document-type starting sequential numbers. Any combination not listed defaults to `1`. |
| `initialSequentials[].issuerId` | integer | Yes (per entry) | Numeric issuer id (from `GET /api/issuers`) |
| `initialSequentials[].documentType` | string | Yes (per entry) | Document type code, e.g. `"01"` |
| `initialSequentials[].sequential` | integer | Yes (per entry) | Next sequential number to issue (≥ 1) |

## Response

**200 OK**

```json
{
  "ok": true,
  "apiKeys": [
    { "label": "Initial sandbox key", "apiKey": "a3f8c2bd..." },
    { "label": "erp-integration",     "apiKey": "d94e17ac..." }
  ]
}
```

`apiKeys` contains one entry per sandbox key that was active at the time of promotion. **Store all tokens immediately — they are shown only once.** Distribute each token to the integration that previously used the sandbox key with the same label.

Sandbox keys are revoked automatically during promotion. If you had no sandbox keys, `apiKeys` will be an empty array — mint production keys via [`POST /api/keys`](api-keys.md#mint-a-key).

## Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `FORBIDDEN` | Tenant email not yet verified |
| `409` | `CONFLICT` | Tenant is already in production |
