# List Issuers

Returns all active issuers (branches / issue points) belonging to the authenticated tenant.

```
GET /api/issuers
```

## Authentication

`Authorization: Bearer <api-key>`

## Response

**200 OK**

```json
{
  "ok": true,
  "issuers": [
    {
      "id": 1,
      "ruc": "1234567890001",
      "businessName": "ACME S.A.",
      "tradeName": "ACME",
      "branchCode": "001",
      "issuePointCode": "001",
      "branchAddress": "Av. Amazonas 123",
      "certFingerprint": "AA:BB:CC:...",
      "certExpiry": "2027-01-01T00:00:00.000Z"
    }
  ]
}
```

### Issuer fields

| Field | Description |
|---|---|
| `id` | Numeric issuer id — pass as `X-Issuer-Id` on document requests |
| `ruc` | Taxpayer RUC |
| `businessName` | Legal business name |
| `tradeName` | Trade name (null if not set) |
| `branchCode` | 3-digit SRI branch code |
| `issuePointCode` | 3-digit SRI issue point code |
| `branchAddress` | Branch address (null if not set) |
| `certFingerprint` | Certificate fingerprint (null if no cert loaded) |
| `certExpiry` | Certificate expiry date (null if no cert loaded) |

## Errors

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
