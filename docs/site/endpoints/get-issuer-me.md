# Get Issuer

Returns profile information for a single issuer owned by the authenticated tenant.

```
GET /api/issuers/:id
```

> **Migrated from `GET /api/issuers/me`** (removed in May 2026). Since API keys are tenant-scoped, "the current issuer" is no longer well-defined — you must name the issuer by id. List all of your tenant's issuers with `GET /api/issuers`.

## Authentication

`Authorization: Bearer <api-key>`

## Path parameters

| Parameter | Description |
|---|---|
| `id` | Numeric issuer id (from `GET /api/issuers`) |

## Response

**200 OK**

```json
{
  "ok": true,
  "issuer": {
    "id": 1,
    "ruc": "1791234567001",
    "businessName": "ACME S.A.",
    "tradeName": "ACME",
    "branchCode": "001",
    "issuePointCode": "001",
    "branchAddress": "Av. Amazonas 123",
    "certFingerprint": "a1b2c3d4e5f6...",
    "certExpiry": "2027-03-15T00:00:00.000Z"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `id` | integer | Numeric issuer id — used as `X-Issuer-Id` on document requests |
| `ruc` | string | 13-digit RUC (tax ID) |
| `businessName` | string | Legal business name |
| `tradeName` | string \| null | Trade name, if set |
| `branchCode` | string | 3-digit SRI branch code |
| `issuePointCode` | string | 3-digit SRI issue point code |
| `branchAddress` | string \| null | Branch address, if set |
| `certFingerprint` | string \| null | SHA-256 fingerprint of the signing certificate |
| `certExpiry` | string \| null | ISO 8601 expiry timestamp of the signing certificate |

## Errors

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `FORBIDDEN` | 403 | Issuer exists but belongs to a different tenant |
| `NOT_FOUND` | 404 | Issuer id does not exist or is inactive |
