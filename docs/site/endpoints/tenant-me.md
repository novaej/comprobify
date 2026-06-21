# Get Current Tenant

Returns identity and account details for the tenant that owns the API key used to authenticate the request. Useful for a third-party app that already has an API key (e.g. issued via `POST /v1/register` or by an admin) and needs to resolve the numeric `tenant.id` — for example, to link an existing API account in a frontend without re-entering the RUC or P12 certificate, or to match incoming webhook deliveries back to the right account.

```
GET /v1/tenants/me
```

## Authentication

`Authorization: Bearer <api-key>`

## Response

```json
{
  "ok": true,
  "tenant": {
    "id": 42,
    "email": "owner@example.com",
    "subscriptionTier": "GROWTH",
    "status": "ACTIVE",
    "documentCount": 128,
    "documentQuota": 1000,
    "sandbox": false
  }
}
```

| Field | Description |
|---|---|
| `id` | Numeric tenant id. Use this to correlate webhook deliveries and other tenant-scoped resources. |
| `email` | Tenant's registered email address. |
| `subscriptionTier` | `FREE`, `STARTER`, `GROWTH`, or `BUSINESS`. |
| `status` | `PENDING_VERIFICATION`, `ACTIVE`, or `SUSPENDED`. |
| `documentCount` | Documents issued in the current billing period. |
| `documentQuota` | Document limit for the current `subscriptionTier`. |
| `sandbox` | `true` if the tenant is in the SRI test environment, `false` if promoted to production. |

## Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `FORBIDDEN` | Account is suspended |
| `429` | `TOO_MANY_REQUESTS` | Rate limit exceeded |

## Notes

- No `X-Issuer-Id` header is required — this endpoint resolves the tenant, not an issuer.
- The response reflects exactly what the `authenticate` middleware already resolved from the API key — there is no separate database lookup, so any active key (sandbox or production) returns its tenant's current state.
- This does not return the list of issuers (branches) — use `GET /v1/issuers` for that.
