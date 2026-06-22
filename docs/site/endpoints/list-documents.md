# List Documents

Retrieves a paginated list of documents for the authenticated issuer with optional filtering by status, document type, date range, sequential, and buyer name, and optional sorting.

```
GET /v1/documents
```

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (numeric id from `GET /v1/issuers`)

## Query parameters

| Parameter | Type | Description |
|---|---|---|
| `status` | string | Filter by status: `SIGNED`, `RECEIVED`, `RETURNED`, `AUTHORIZED`, `NOT_AUTHORIZED` (optional) |
| `documentType` | string | Filter by document type code: `01`, `03`, `04`, `05`, `06`, `07` (optional) |
| `from` | string | Filter by issue date >= DD/MM/YYYY format (optional) |
| `to` | string | Filter by issue date <= DD/MM/YYYY format (optional) |
| `sequential` | string | Filter by sequential, contains match, case-insensitive (optional) |
| `buyerName` | string | Filter by buyer name, contains match, case-insensitive (optional) |
| `sortBy` | string | Sort by `sequential`, `buyerName`, `issueDate`, or `status` (optional). When omitted, results are sorted by creation date (newest first) — no behavior change for existing callers |
| `sortDir` | string | `asc` or `desc` (optional). Defaults to `desc` when `sortBy` is given without `sortDir` |
| `page` | integer | Page number, defaults to 1 (optional) |
| `limit` | integer | Results per page, 1-100, defaults to 10 (optional) |

All filters combine with `AND`.

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
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `VALIDATION_FAILED` | 400 | Invalid query parameter (e.g., invalid status, invalid date format) |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch (sandbox key targeting a production tenant or vice versa) |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
