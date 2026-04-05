# Get Events

Returns the full audit event history for a document in chronological order.

```
GET /api/documents/:accessKey/events
```

## Authentication

`Authorization: Bearer <api-key>`

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
| `EMAIL_FAILED` | Email send failed permanently |
| `EMAIL_DELIVERED` | Mailgun confirmed delivery to the recipient's mail server |
| `EMAIL_TEMP_FAILED` | Temporary delivery failure — Mailgun will retry |
| `EMAIL_COMPLAINED` | Recipient marked the email as spam |

## Errors

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `NOT_FOUND` | 404 | Document not found |
