# Retry Email (Single)

Retries the authorization email for a specific document.

```
POST /api/documents/:accessKey/email-retry
```

By default only retries if `email_status` is `PENDING` or `FAILED`. Add `?force=true` to resend even if the email was already successfully sent.

## Authentication

`Authorization: Bearer <api-key>`

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the document |

## Query parameters

| Parameter | Required | Description |
|---|---|---|
| `force` | No | Set to `true` to resend even if `email_status` is already `SENT` or `DELIVERED` |

## Response

**200 OK**

```json
{
  "ok": true,
  "result": {
    "sent": true,
    "messageId": "20260315.abc123@mg.yourdomain.com"
  }
}
```

## Errors

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `NOT_FOUND` | 404 | Document not found |
| `BAD_REQUEST` | 400 | Document is not `AUTHORIZED`, or email already sent and `force` not set |
