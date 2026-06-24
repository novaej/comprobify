# Document Stats

Returns a per-type breakdown of documents issued this month plus an all-time count of documents needing attention. Intended for dashboard summaries (e.g. the comprobify-web revenue widget, computed client-side from `authorizedTotal` values).

```
GET /v1/documents/stats
```

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (numeric id from `GET /v1/issuers`)

## Response

**200 OK**

```json
{
  "ok": true,
  "stats": {
    "thisMonth": {
      "byType": [
        { "type": "FAC", "issued": 5, "authorizedTotal": "1800.00" },
        { "type": "CRE", "issued": 2, "authorizedTotal": "260.00" }
      ]
    },
    "needsAttention": 3
  }
}
```

## Field rules

- `byType` — only document types with at least one document issued this calendar month (empty types are omitted)
- `authorizedTotal` — sum of `total` for documents with status `AUTHORIZED`, as a decimal string (`"0.00"` if none authorized)
- `needsAttention` — all-time count of documents with status `RETURNED` or `NOT_AUTHORIZED`
- `type` — short code from the document type catalog: `'01'` → `FAC`, `'03'` → `LIQ`, `'04'` → `CRE`, `'05'` → `DEB`, `'06'` → `REM`, `'07'` → `RET`

## Errors

| Code | Status | When |
|---|---|---|
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch (sandbox key targeting a production tenant or vice versa) |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
