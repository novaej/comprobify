# List Documents

Retrieves a paginated list of documents for the authenticated issuer with optional filtering by status, document type, and date range.

```
GET /api/documents
```

## Authentication

`Authorization: Bearer <api-key>`

## Query parameters

| Parameter | Type | Description |
|---|---|---|
| `status` | string | Filter by status: `SIGNED`, `RECEIVED`, `RETURNED`, `AUTHORIZED`, `NOT_AUTHORIZED` (optional) |
| `documentType` | string | Filter by document type code, e.g. `01` for invoice (optional) |
| `from` | string | Filter by issue date >= DD/MM/YYYY format (optional) |
| `to` | string | Filter by issue date <= DD/MM/YYYY format (optional) |
| `page` | integer | Page number, defaults to 1 (optional) |
| `limit` | integer | Results per page, 1-100, defaults to 10 (optional) |

## Response

**200 OK**

```json
{
  "ok": true,
  "data": [
    {
      "accessKey": "1503202601179234567800110010010000000011234567810",
      "documentType": "01",
      "sequential": "000000001",
      "status": "AUTHORIZED",
      "issueDate": "15/03/2026",
      "total": "115.00",
      "authorizationNumber": "1503202601179234567800110010010000000011234567810",
      "authorizationDate": "2026-03-15T14:22:00-05:00",
      "email": {
        "status": "DELIVERED",
        "sentAt": "2026-03-15T14:22:05.123Z"
      }
    }
  ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 10
  }
}
```

## Errors

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `VALIDATION_FAILED` | 400 | Invalid query parameter (e.g., invalid status, invalid date format) |
