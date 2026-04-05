# Unauthorized

**Code:** `UNAUTHORIZED`
**Status:** `401 Unauthorized`

The request did not include a valid API key, or the key has been revoked.

## Response

```json
{
  "type":     "https://novaej.gitbook.io/comprobify-api-docs/errors/unauthorized",
  "title":    "Unauthorized",
  "status":   401,
  "code":     "UNAUTHORIZED",
  "detail":   "Invalid or revoked API key",
  "instance": "/api/documents"
}
```

## What to do

- Ensure the `Authorization` header is present and formatted correctly: `Bearer <api-key>`
- Verify the key has not been revoked — contact your admin to issue a new key if needed
- Admin endpoints require the admin secret, not a regular API key
