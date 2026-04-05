# Retry Emails (Batch)

Retries sending the authorization email for all documents belonging to this issuer that have `email_status` of `PENDING` or `FAILED`.

```
POST /api/documents/email-retry
```

## Authentication

`Authorization: Bearer <api-key>`

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
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
