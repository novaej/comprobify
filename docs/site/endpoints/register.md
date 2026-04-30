# Register

Self-service registration. Creates a tenant, issuer, and sandbox API key in one call. The returned API key is shown **once** — store it immediately.

```
POST /api/register
```

## Authentication

None — public endpoint.

## Rate limiting

Shared with `POST /api/resend-verification` — 5 requests per hour per IP.

## Request body

`multipart/form-data` (required — a P12 certificate file must be included).

| Field | Type | Required | Description |
|---|---|---|---|
| `cert` | file | Yes | P12 certificate file from SRI |
| `certPassword` | string | No | P12 password (omit if none) |
| `email` | string | Yes | Tenant contact email — used for verification and invoice notifications |
| `ruc` | string | Yes | 13-digit RUC |
| `businessName` | string | Yes | Legal business name (max 300 chars) |
| `tradeName` | string | No | Trade name |
| `mainAddress` | string | No | Main address |
| `branchCode` | string | Yes | 3-digit branch code, e.g. `001` |
| `issuePointCode` | string | Yes | 3-digit issue point code, e.g. `001` |
| `environment` | string | Yes | `1` (test) or `2` (production) |
| `emissionType` | string | Yes | `1` (normal emission) |
| `requiredAccounting` | boolean | Yes | Whether the business is required to keep accounting |
| `specialTaxpayer` | string | No | Special taxpayer code |
| `branchAddress` | string | No | Branch address |
| `documentTypes` | array | No | Document type codes to enable (default: `["01"]`). Must be supported types. |
| `initialSequentials` | array | No | Starting sequential numbers per document type: `[{ "documentType": "01", "sequential": 1 }]` |
| `verificationRedirectUrl` | string | No | Frontend URL where the verification link in the email will point. The token is appended as `?token=<token>`. If omitted, the link goes directly to the API's verify endpoint. |

### `verificationRedirectUrl` behaviour

When set, the verification email contains a link to your frontend page:

```
https://app.yourdomain.com/verify?token=<64-char-hex>
```

Your frontend page should display a confirmation UI and then call `GET /api/verify-email?token=<token>` on user action.

When omitted, the link goes directly to the API:

```
https://api.yourdomain.com/api/verify-email?token=<64-char-hex>
```

**Validation:** in production (`APP_ENV=production`) the URL must use `https`. In staging, `http` is also accepted.

## Response

### 201 Created — new registration

```json
{
  "ok": true,
  "tenant": {
    "id": 1,
    "email": "you@company.com",
    "subscriptionTier": "FREE",
    "status": "PENDING_VERIFICATION",
    "invoiceQuota": 100,
    "invoiceCount": 0,
    "createdAt": "2026-04-30T00:00:00.000Z"
  },
  "issuer": {
    "id": 1,
    "ruc": "1712345678001",
    "businessName": "My Company S.A.",
    "tradeName": null,
    "environment": "1",
    "branchCode": "001",
    "issuePointCode": "001",
    "certFingerprint": "SHA256:...",
    "certExpiry": "2027-01-01T00:00:00.000Z",
    "sandbox": true
  },
  "apiKey": "abc123..."
}
```

### 200 OK — email already registered (key recovery)

If the email is already registered and not suspended, the current sandbox key is revoked and a fresh one is returned. Same response shape as 201 but with `recovered: true`.

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Missing or invalid fields, or missing P12 file |
| `403` | `FORBIDDEN` | The account is suspended |
| `409` | `CONFLICT` | RUC already registered under a different email |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- The tenant starts in `PENDING_VERIFICATION` status. A verification email is sent immediately (fire-and-forget).
- Unverified tenants can use sandbox but cannot promote to production.
- The verification token expires after the configured TTL (default 24 hours). Use `POST /api/resend-verification` to issue a fresh one.
- The endpoint is idempotent on the email address — safe to retry if the API key was lost.
