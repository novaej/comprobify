# Get Issuer

Returns profile information for the issuer associated with the current API key.

```
GET /api/issuers/me
```

## Authentication

`Authorization: Bearer <api-key>`

## Response

**200 OK**

```json
{
  "ok": true,
  "issuer": {
    "ruc": "1791234567001",
    "businessName": "ACME S.A.",
    "tradeName": "ACME",
    "branchCode": "001",
    "issuePointCode": "001",
    "sandbox": true,
    "certFingerprint": "a1b2c3d4e5f6...",
    "certExpiry": "2027-03-15T00:00:00.000Z"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `ruc` | string | 13-digit RUC (tax ID) |
| `businessName` | string | Legal business name |
| `tradeName` | string \| null | Trade name, if set |
| `branchCode` | string | 3-digit SRI branch code |
| `issuePointCode` | string | 3-digit SRI issue point code |
| `sandbox` | boolean | `true` if the issuer is in sandbox mode; `false` if promoted to production |
| `certFingerprint` | string \| null | SHA-256 fingerprint of the signing certificate |
| `certExpiry` | string \| null | ISO 8601 expiry timestamp of the signing certificate |

## Errors

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
