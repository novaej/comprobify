# Forbidden

**Status:** `403 Forbidden`

The API key is valid and the resource exists, but you do not have permission to perform this operation. Every 403 error carries a specific `code` — use it to handle each case programmatically.

## Codes

### `ISSUER_FORBIDDEN`

The `X-Issuer-Id` header names an issuer that exists but belongs to a different tenant. Each tenant can only operate on its own issuers.

**What to do:** Call `GET /v1/issuers` with the same API key to list your tenant's issuers, then re-issue the request with a valid `X-Issuer-Id`.

### `ACCOUNT_SUSPENDED`

The tenant account has been suspended. All authenticated requests will fail until the suspension is lifted.

**What to do:** Contact support. Suspended accounts cannot self-recover.

### `EMAIL_VERIFICATION_REQUIRED`

The operation requires email verification to have been completed. This blocks:
- Creating additional branches (`POST /v1/issuers`)
- Promoting to production (`POST /v1/tenants/promote`)
- Minting new API keys (`POST /v1/keys`)

**What to do:** Check the inbox for the original verification email, or request a new one via `POST /v1/resend-verification`. Then retry the original operation.

### `PRODUCTION_KEY_REQUIRES_PROMOTION`

A production API key can only be created if the tenant has already promoted to production at least once. Before promotion, only sandbox keys can be minted.

**What to do:** Call `POST /v1/tenants/promote` to promote the tenant to production. Production keys will be issued automatically as part of that response. Additional production keys can be minted afterwards via `POST /v1/keys`.

### `FORBIDDEN` (fallback)

A generic 403 not covered by a specific code above. Read `detail`.

## Example responses

```json
{
  "type":     "https://novaej.github.io/comprobify/errors/forbidden",
  "title":    "Forbidden",
  "status":   403,
  "code":     "ISSUER_FORBIDDEN",
  "detail":   "Issuer does not belong to this tenant",
  "instance": "/v1/documents"
}
```

```json
{
  "type":     "https://novaej.github.io/comprobify/errors/forbidden",
  "title":    "Forbidden",
  "status":   403,
  "code":     "EMAIL_VERIFICATION_REQUIRED",
  "detail":   "Email verification is required before creating additional branches. Check your inbox.",
  "instance": "/v1/issuers"
}
```
