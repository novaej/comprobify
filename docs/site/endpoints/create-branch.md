# Create Branch / Issue Point

Creates a new branch or issue point for the authenticated tenant. The new issuer inherits the RUC, business name, and certificate from an existing issuer of the tenant. **No new API key is minted** — your existing tenant key already covers every branch via the `X-Issuer-Id` header.

```
POST /v1/issuers
```

## Authentication

`Authorization: Bearer <api-key>`

## Rate limiting

Write limiter — tier-dependent (10–300 req/min per API key).

## Request body

`multipart/form-data`. If no P12 file is uploaded, the new branch reuses the certificate from another of your existing issuers.

| Field | Type | Required | Description |
|---|---|---|---|
| `branchCode` | string | Yes | 3-digit SRI branch code, e.g. `002` |
| `issuePointCode` | string | Yes | 3-digit SRI issue point code, e.g. `001` |
| `branchAddress` | string | No | Branch address (max 300 chars) |
| `documentTypes` | array | No | Document type codes to enable (default: `["01"]`) |
| `initialSequentials` | array | No | Starting sequential numbers: `[{ "documentType": "01", "sequential": 1 }]` |
| `sourceIssuerId` | integer | No | Numeric id of the issuer to inherit cert/profile from. Defaults to the tenant's first existing issuer. Ignored if a `cert` file is uploaded. |
| `cert` | file | No | P12 certificate file — only needed if this branch uses a different certificate |
| `certPassword` | string | No | P12 password — only when providing a `cert` file |

### Inherited from the source issuer

When no P12 file is uploaded, the following fields are copied from the source issuer (either the one named in `sourceIssuerId` or the tenant's first issuer):

- `ruc`, `businessName`, `tradeName`, `mainAddress`
- `emissionType`, `requiredAccounting`, `specialTaxpayer`
- Certificate data (`encryptedPrivateKey`, `certificatePem`, `certFingerprint`, `certExpiry`)

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
    "certFingerprint": "SHA256:...",
    "certExpiry": "2027-01-01T00:00:00.000Z"
  }
}
```

The returned `id` is what you pass as `X-Issuer-Id` on document requests targeting this branch. New branches inherit the tenant's current environment (sandbox or production). Use [`POST /v1/tenants/promote`](promote-tenant.md) to promote the entire tenant to production.

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Missing or invalid fields, or the tenant has no existing issuer to inherit from and no P12 was uploaded |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `402` | `PAYMENT_REQUIRED` | Branch or issue point limit reached for this tier |
| `403` | `FORBIDDEN` | Tenant email not yet verified |
| `404` | `NOT_FOUND` | `sourceIssuerId` does not exist or belongs to a different tenant |
| `409` | `CONFLICT` | A branch with this `branchCode` + `issuePointCode` combination already exists |
