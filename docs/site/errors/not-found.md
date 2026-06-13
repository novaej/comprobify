# Not Found

**Status:** `404 Not Found`

The requested resource does not exist or is not accessible to this tenant.

## Codes

### `ISSUER_NOT_FOUND`

The issuer ID supplied in `X-Issuer-Id` or a URL parameter (`/v1/issuers/:id/…`) does not match any active issuer.

**What to do:** Call `GET /v1/issuers` to list your tenant's issuers and verify the ID.

### `SOURCE_ISSUER_NOT_FOUND`

The `sourceIssuerId` field on `POST /v1/issuers` (branch creation) does not match any issuer that belongs to this tenant.

**What to do:** Ensure `sourceIssuerId` is the numeric ID of one of your tenant's existing issuers, returned by `GET /v1/issuers`.

### `NOT_FOUND` (fallback)

A generic not-found response for other resources (documents, API keys, etc.). Read `detail` for the specific resource type.

**What to do:**
- For documents — verify the access key is exactly 49 digits and was created by an issuer belonging to this tenant
- For API keys — verify the key ID in the URL; list active keys with `GET /v1/keys`

## Example responses

```json
{
  "type":     "https://docs.comprobify.com/errors/not-found",
  "title":    "Not Found",
  "status":   404,
  "code":     "ISSUER_NOT_FOUND",
  "detail":   "Issuer not found",
  "instance": "/v1/documents"
}
```

```json
{
  "type":     "https://docs.comprobify.com/errors/not-found",
  "title":    "Not Found",
  "status":   404,
  "code":     "NOT_FOUND",
  "detail":   "Document not found",
  "instance": "/v1/documents/0000000000000000000000000000000000000000000000000"
}
```
