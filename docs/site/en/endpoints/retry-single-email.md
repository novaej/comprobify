# Retry Email (Single)

Retries the authorization email for a specific document.

```
POST /v1/documents/:accessKey/email-retry
```

By default only retries if `email_status` is `PENDING` or `FAILED`. Add `?force=true` to resend even if the email was already successfully sent.

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (UUID from `GET /v1/issuers`)

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
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `BAD_REQUEST` | 400 | Document is not `AUTHORIZED`, or email already sent and `force` not set |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch (sandbox key targeting a production tenant or vice versa) |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
| `NOT_FOUND` | 404 | Document not found |
