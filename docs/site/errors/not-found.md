# Not Found

**Status:** `404 Not Found`

The requested resource does not exist or is not accessible to this tenant.

## Codes

### `ISSUER_NOT_FOUND`

The issuer ID supplied in `X-Issuer-Id` or a URL parameter (`/api/issuers/:id/…`) does not match any active issuer.

**What to do:** Call `GET /api/issuers` to list your tenant's issuers and verify the ID.

### `SOURCE_ISSUER_NOT_FOUND`

The `sourceIssuerId` field on `POST /api/issuers` (branch creation) does not match any issuer that belongs to this tenant.

**What to do:** Ensure `sourceIssuerId` is the numeric ID of one of your tenant's existing issuers, returned by `GET /api/issuers`.

### `NOT_FOUND` (fallback)

A generic not-found response for other resources (documents, API keys, etc.). Read `detail` for the specific resource type.

**What to do:**
- For documents — verify the access key is exactly 49 digits and was created by an issuer belonging to this tenant
- For API keys — verify the key ID in the URL; list active keys with `GET /api/keys`

## Example responses

```json
{
  "type":     "https://novaej.github.io/comprobify/errors/not-found",
  "title":    "Not Found",
  "status":   404,
  "code":     "ISSUER_NOT_FOUND",
  "detail":   "Issuer not found",
  "instance": "/api/documents"
}
```

```json
{
  "type":     "https://novaej.github.io/comprobify/errors/not-found",
  "title":    "Not Found",
  "status":   404,
  "code":     "NOT_FOUND",
  "detail":   "Document not found",
  "instance": "/api/documents/0000000000000000000000000000000000000000000000000"
}
```
