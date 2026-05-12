# Unauthorized

**Code:** `UNAUTHORIZED`
**Status:** `401 Unauthorized`

The request did not include a valid API key, the key has been revoked, or the key's environment (`sandbox` / `production`) does not match the target issuer's environment.

## Response

```json
{
  "type":     "https://novaej.github.io/comprobify/errors/unauthorized",
  "title":    "Unauthorized",
  "status":   401,
  "code":     "UNAUTHORIZED",
  "detail":   "Invalid or revoked API key",
  "instance": "/api/documents"
}
```

## What to do

- Ensure the `Authorization` header is present and formatted correctly: `Bearer <api-key>`
- Verify the key has not been revoked — mint a new one via `POST /api/keys` if needed
- If you are using a sandbox key against a production issuer (or vice versa), use a key whose `environment` matches the target issuer. List your keys with `GET /api/keys`
- Admin endpoints require the admin secret, not a regular API key
