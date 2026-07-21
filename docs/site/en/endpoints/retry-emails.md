# Retry Emails (Batch)

Retries sending the authorization email for all documents belonging to this issuer that have `email_status` of `PENDING` or `FAILED`.

```
POST /v1/documents/email-retry
```

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (UUID from `GET /v1/issuers`)

## Response

**200 OK**

```json
{
  "ok": true,
  "result": {
    "attempted": 3,
    "succeeded": 2,
    "failed": 1
  }
}
```

## Errors

| Code | Status | When |
|---|---|---|
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch (sandbox key targeting a production tenant or vice versa) |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
