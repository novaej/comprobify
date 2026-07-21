# Update Issuer

Edits the trade name and/or branch address for an existing issuer.

```
PATCH /v1/issuers/:id
```

## Authentication

`Authorization: Bearer <api-key>`

## Path parameters

| Parameter | Description |
|---|---|
| `id` | Issuer UUID (from `GET /v1/issuers`) |

## Request body

At least one field is required.

```json
{
  "tradeName": "ACME Express",
  "branchAddress": "Av. Amazonas 456"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `tradeName` | string | One of the two | Max 300 characters |
| `branchAddress` | string | One of the two | Max 300 characters |

`businessName`, `mainAddress`, and `ruc` cannot be edited through this endpoint — they stay permanently tied to the RUC registration.

## Response

**200 OK**

```json
{
  "ok": true,
  "issuer": {
    "id": "00000000-0000-0000-0000-000000000001",
    "ruc": "1234567890001",
    "businessName": "ACME S.A.",
    "tradeName": "ACME Express",
    "branchCode": "001",
    "issuePointCode": "001",
    "branchAddress": "Av. Amazonas 456",
    "certFingerprint": "AA:BB:CC:...",
    "certExpiry": "2027-01-01T00:00:00.000Z"
  }
}
```

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Neither `tradeName` nor `branchAddress` provided, or a field exceeds 300 characters |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `ISSUER_FORBIDDEN` | Issuer belongs to a different tenant |
| `404` | `ISSUER_NOT_FOUND` | Issuer not found or inactive |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |
