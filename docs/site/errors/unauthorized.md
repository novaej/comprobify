# Unauthorized

**Status:** `401 Unauthorized`

The request did not include a valid API key, the key has been revoked, or there is an environment mismatch between the key and the tenant.

## Codes

### `API_KEY_ENV_MISMATCH`

The API key's environment (`sandbox` or `production`) does not match the tenant's current environment. For example: using a sandbox key after the tenant has promoted to production, or using a production key against a tenant still in sandbox mode.

**What to do:** Use a key whose environment matches the tenant. List your active keys with `GET /v1/keys`. Sandbox and production keys are issued separately — sandbox keys are created at registration; production keys are issued automatically at promotion (`POST /v1/tenants/promote`) or minted manually afterwards.

### `UNAUTHORIZED` (fallback)

The API key is missing, malformed, invalid, or has been revoked.

**What to do:**
- Ensure the `Authorization` header is present and formatted correctly: `Bearer <api-key>`
- Verify the key has not been revoked — mint a new one via `POST /v1/keys` if needed
- Admin endpoints require the admin secret in `Authorization: Bearer <ADMIN_SECRET>`, not a regular API key

## Example responses

```json
{
  "type":     "https://docs.comprobify.com/errors/unauthorized",
  "title":    "Unauthorized",
  "status":   401,
  "code":     "API_KEY_ENV_MISMATCH",
  "detail":   "This API key was created for the sandbox environment. The tenant is production. Use a key created for the matching environment.",
  "instance": "/v1/documents"
}
```

```json
{
  "type":     "https://docs.comprobify.com/errors/unauthorized",
  "title":    "Unauthorized",
  "status":   401,
  "code":     "UNAUTHORIZED",
  "detail":   "Invalid or revoked API key",
  "instance": "/v1/documents"
}
```
