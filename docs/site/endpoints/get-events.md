# Get Events

Returns the full audit event history for a document in chronological order.

```
GET /v1/documents/:accessKey/events
```

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (numeric id from `GET /v1/issuers`)

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the document |

## Response

**200 OK**

```json
{
  "ok": true,
  "events": [
    {
      "eventType": "CREATED",
      "fromStatus": null,
      "toStatus": "SIGNED",
      "detail": null,
      "createdAt": "2026-03-15T14:20:00.000Z"
    },
    {
      "eventType": "SENT",
      "fromStatus": "SIGNED",
      "toStatus": "RECEIVED",
      "detail": null,
      "createdAt": "2026-03-15T14:21:00.000Z"
    },
    {
      "eventType": "STATUS_CHANGED",
      "fromStatus": "RECEIVED",
      "toStatus": "AUTHORIZED",
      "detail": { "authorizationNumber": "1503202601179234567800110010010000000011234567810" },
      "createdAt": "2026-03-15T14:22:00.000Z"
    },
    {
      "eventType": "EMAIL_SENT",
      "fromStatus": null,
      "toStatus": null,
      "detail": null,
      "createdAt": "2026-03-15T14:22:05.000Z"
    }
  ]
}
```

### Event types

| Event | Meaning |
|---|---|
| `CREATED` | Document created and signed |
| `SENT` | Submitted to SRI |
| `STATUS_CHANGED` | SRI returned a new status |
| `REBUILT` | Document was rebuilt after rejection |
| `ERROR` | An error occurred during a lifecycle operation |
| `EMAIL_SENT` | Authorization email sent to buyer |
| `EMAIL_FAILED` | Email send was attempted and failed |
| `EMAIL_SKIPPED` | Email was intentionally not sent (e.g. no buyer email on file) — no send was attempted |
| `EMAIL_DELIVERED` | Mailgun confirmed delivery to the recipient's mail server |
| `EMAIL_TEMP_FAILED` | Temporary delivery failure — Mailgun will retry |
| `EMAIL_COMPLAINED` | Recipient marked the email as spam |

## Errors

| Code | Status | When |
|---|---|---|
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch (sandbox key targeting a production tenant or vice versa) |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
| `NOT_FOUND` | 404 | Document not found |
