# Remove Issuer

Soft-deletes an issuer (sets `active = false`). No hard deletes — the row and its history remain in the database.

```
DELETE /v1/issuers/:id
```

## Authentication

`Authorization: Bearer <api-key>`

## Path parameters

| Parameter | Description |
|---|---|
| `id` | Issuer UUID (from `GET /v1/issuers`) |

## Guard rails

- **Cannot remove the tenant's last active issuer.** Every tenant must keep at least one.
- **Cannot remove an issuer that has ever issued a document** — checked in both the `production` and `sandbox` schemas. Create a new issuer instead of reusing one with history.

## Response

**200 OK**

```json
{ "ok": true }
```

## Errors

| Status | Code | When |
|---|---|---|
| `400` | `LAST_ISSUER_CANNOT_BE_REMOVED` | This is the tenant's only remaining active issuer |
| `400` | `ISSUER_HAS_DOCUMENTS` | The issuer has issued at least one document |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `ISSUER_FORBIDDEN` | Issuer belongs to a different tenant |
| `404` | `ISSUER_NOT_FOUND` | Issuer not found or already inactive |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |
