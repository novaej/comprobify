# Register

Self-service registration. Creates a tenant, issuer, and sandbox API key in one call. The returned API key is shown **once** — store it immediately.

```
POST /v1/register
```

## Authentication

None — public endpoint.

## Rate limiting

Shared with `POST /v1/resend-verification` — 5 requests per hour per IP.

## Request body

`multipart/form-data` (required — a P12 certificate file must be included).

| Field | Type | Required | Description |
|---|---|---|---|
| `cert` | file | Yes | P12 certificate file from SRI |
| `certPassword` | string | No | P12 password (omit if none) |
| `logo` | file | No | Company logo to display in RIDE PDFs. Accepted formats: **PNG** (recommended), JPEG, GIF. Max size: **500 KB**. Recommended dimensions: **600 × 170 px** (landscape, ~3.5:1 ratio). Can be uploaded or replaced later via `PATCH /v1/issuers/:id/logo`. |
| `email` | string | Yes | Tenant contact email — used for verification and invoice notifications |
| `ruc` | string | Yes | 13-digit RUC |
| `businessName` | string | Yes | Legal business name (max 300 chars) |
| `tradeName` | string | No | Trade name |
| `mainAddress` | string | No | Main address |
| `branchCode` | string | Yes | 3-digit branch code, e.g. `001` |
| `issuePointCode` | string | Yes | 3-digit issue point code, e.g. `001` |
| `emissionType` | string | Yes | `1` (normal emission) |
| `requiredAccounting` | boolean | Yes | Whether the business is required to keep accounting |
| `specialTaxpayer` | string | No | Special taxpayer code |
| `branchAddress` | string | No | Branch address |
| `documentTypes` | array | No | Document type codes to enable (default: `["01"]`). Must be supported types. |
| `initialSequentials` | array | No | Starting sequential numbers per document type. Any type not listed defaults to `1`. See structure below. |
| `language` | string | No | Language for outgoing emails. Supported: `es` (default), `en`. Stored on the tenant and used for all subsequent emails including resends. |
| `verificationRedirectUrl` | string | No | Frontend URL where the verification link in the email will point. The token is appended as `?token=<token>`. If omitted, the link goes directly to the API's verify endpoint. |
| `termsVersion` | string | Yes | The `version` string of the currently published TERMS document (from `GET /v1/agreements`). The server validates this before accepting the registration. If no documents have been published yet, any non-empty string is accepted as-is (pre-launch fallback). |

### `initialSequentials` structure

Each entry sets the first sequential number that will be issued for a given document type on this issuer. Useful when migrating from another system and you need continuity.

| Field | Type | Required | Description |
|---|---|---|---|
| `documentType` | string | Yes | Document type code, e.g. `"01"` |
| `sequential` | integer | Yes | Next sequential number to issue (≥ 1) |

```json
{
  "initialSequentials": [
    { "documentType": "01", "sequential": 500 }
  ]
}
```

### `verificationRedirectUrl` behaviour

When set, the verification email contains a link to your frontend page:

```
https://app.comprobify.com/verify?token=<64-char-hex>
```

Your frontend page should display a confirmation UI and then call `GET /v1/verify-email?token=<token>` on user action.

When omitted, the link goes directly to the API:

```
https://api.comprobify.com/v1/verify-email?token=<64-char-hex>
```

**Validation:** in production the URL must use `https`. In other environments, `http` is also accepted.

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
    "documentQuota": 100,
    "documentCount": 0,
    "createdAt": "2026-04-30T00:00:00.000Z",
    "agreementAcceptedAt": "2026-06-28T12:00:00.000Z",
    "agreementVersion": "2026-06-28"
  },
  "issuer": {
    "id": 1,
    "ruc": "1712345678001",
    "businessName": "My Company S.A.",
    "tradeName": null,
    "branchCode": "001",
    "issuePointCode": "001",
    "certFingerprint": "SHA256:...",
    "certExpiry": "2027-01-01T00:00:00.000Z"
  },
  "apiKey": "abc123..."
}
```

### 200 OK — email already registered (key recovery)

If the email is already registered and not suspended, the current sandbox key is revoked and a fresh one is returned. Same response shape as 201 but with `recovered: true`.

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Missing or invalid fields, or missing P12 file or `termsVersion` |
| `400` | `VERSION_MISMATCH` | `termsVersion` does not match the currently published TERMS version — re-fetch `GET /v1/agreements` and show the current version |
| `400` | `BAD_REQUEST` | P12 file is corrupt or the certificate password is wrong |
| `400` | `INVALID_FILE_UPLOAD` | Logo file exceeds 500 KB |
| `403` | `FORBIDDEN` | The account is suspended |
| `409` | `CONFLICT` | RUC already registered under a different email |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- The tenant starts in `PENDING_VERIFICATION` status. A verification email is sent immediately (fire-and-forget).
- Unverified tenants can use sandbox but cannot promote to production.
- The verification token expires after the configured TTL (default 24 hours). Use `POST /v1/resend-verification` to issue a fresh one.
- The endpoint is idempotent on the email address — safe to retry if the API key was lost.
- Fetch the current `termsVersion` from `GET /v1/agreements` immediately before showing the acceptance checkbox, not at page load — the server validates the submitted version and rejects stale ones.
- Returning tenants whose acceptance version has drifted (e.g. after the DPA is updated) should use `GET /v1/tenants/agreements` to discover which documents need re-accepting, and `POST /v1/tenants/agreements` to record the new acceptance. See [Agreement Acceptance](agreement-acceptance.md).
