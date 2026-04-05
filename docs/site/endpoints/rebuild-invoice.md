# Rebuild Invoice

Corrects and re-signs a rejected document. The rebuilt document keeps the same `accessKey`, `sequential`, and `issueDate` as the original.

```
POST /api/documents/:accessKey/rebuild
```

Use this when a document is in `RETURNED` or `NOT_AUTHORIZED` status. After rebuilding, send it again with [Send to SRI](send-to-sri.md).

## Authentication

`Authorization: Bearer <api-key>`

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the document to rebuild |

## Request body

Same schema as [Create Invoice](create-invoice.md). Supply the corrected invoice content. The `issueDate` from the original document is preserved regardless of what is supplied here.

## Response

**200 OK**

```json
{
  "ok": true,
  "document": {
    "accessKey": "1503202601179234567800110010010000000011234567810",
    "documentType": "01",
    "sequential": "000000001",
    "status": "SIGNED",
    "issueDate": "15/03/2026",
    "total": "120.00",
    "email": {
      "status": "PENDING"
    }
  }
}
```

## Errors

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Request body fails field validation |
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `NOT_FOUND` | 404 | Document not found |
| `BAD_REQUEST` | 400 | Document is not in `RETURNED` or `NOT_AUTHORIZED` status |
