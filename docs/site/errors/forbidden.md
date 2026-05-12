# Forbidden

**Code:** `FORBIDDEN`
**Status:** `403 Forbidden`

The API key is valid and the resource exists, but you do not have permission to operate on it. Common causes:

- The `X-Issuer-Id` header names an issuer that belongs to a different tenant
- The tenant is `PENDING_VERIFICATION` and the action requires email verification (creating a branch, promoting to production, minting a production key)
- The tenant is `SUSPENDED` — contact support

## Response

```json
{
  "type":     "https://novaej.github.io/comprobify/errors/forbidden",
  "title":    "Forbidden",
  "status":   403,
  "code":     "FORBIDDEN",
  "detail":   "Issuer does not belong to this tenant",
  "instance": "/api/documents"
}
```

## What to do

- **Issuer ownership** — call `GET /api/issuers` with the same key to list your tenant's issuers, then re-issue the request with a valid `X-Issuer-Id`.
- **Email verification** — check the inbox for the verification email or call `POST /api/resend-verification`. Then retry.
- **Account suspended** — read the response `detail`. Suspended accounts cannot self-recover; contact support.
