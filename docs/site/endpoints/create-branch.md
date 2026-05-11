# Create Branch / Issue Point

Creates a new branch or issue point for the authenticated tenant. The new issuer inherits the RUC, business name, and certificate from the issuer identified by the API key used to make the request. A new sandbox API key is returned.

```
POST /api/issuers
```

## Authentication

`Authorization: Bearer <api-key>`

## Rate limiting

Write limiter — tier-dependent (10–300 req/min per API key).

## Request body

`multipart/form-data`. The certificate fields are optional — if no P12 file is uploaded, the new branch reuses the certificate from the calling issuer.

| Field | Type | Required | Description |
|---|---|---|---|
| `branchCode` | string | Yes | 3-digit SRI branch code, e.g. `002` |
| `issuePointCode` | string | Yes | 3-digit SRI issue point code, e.g. `001` |
| `branchAddress` | string | No | Branch address (max 300 chars) |
| `documentTypes` | array | No | Document type codes to enable (default: `["01"]`) |
| `initialSequentials` | array | No | Starting sequential numbers: `[{ "documentType": "01", "sequential": 1 }]` |
| `cert` | file | No | P12 certificate file — only needed if this branch uses a different certificate |
| `certPassword` | string | No | P12 password — only when providing a `cert` file |

### Inherited from calling issuer

The following fields are copied from the issuer that owns the API key used to authenticate:

- `ruc`, `businessName`, `tradeName`, `mainAddress`
- `environment`, `emissionType`, `requiredAccounting`, `specialTaxpayer`
- Certificate data (`encryptedPrivateKey`, `certificatePem`, `certFingerprint`, `certExpiry`) — unless a new `cert` file is uploaded

### Tier limits

| Tier | Max branches | Max issue points per branch |
|---|---|---|
| FREE | 1 | 1 |
| STARTER | 3 | 2 |
| GROWTH | 10 | 5 |
| BUSINESS | Unlimited | Unlimited |

A new branch is counted when `branchCode` does not yet exist for the tenant. Adding a second issue point to an existing branch counts against `maxIssuePointsPerBranch`.

## Response

**201 Created**

```json
{
  "ok": true,
  "issuer": {
    "id": 2,
    "ruc": "1712345678001",
    "businessName": "My Company S.A.",
    "tradeName": "My Company",
    "branchCode": "002",
    "issuePointCode": "001",
    "branchAddress": "Av. 6 de Diciembre 123",
    "sandbox": true,
    "certFingerprint": "SHA256:...",
    "certExpiry": "2027-01-01T00:00:00.000Z"
  },
  "apiKey": "abc123..."
}
```

The `apiKey` is shown **once** — store it immediately. The new issuer always starts in sandbox mode; use `POST /api/issuers/promote` to move it to production.

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Missing or invalid fields |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `402` | `PAYMENT_REQUIRED` | Branch or issue point limit reached for this tier |
| `403` | `FORBIDDEN` | Tenant email not yet verified |
| `409` | `CONFLICT` | A branch with this `branchCode` + `issuePointCode` combination already exists |
