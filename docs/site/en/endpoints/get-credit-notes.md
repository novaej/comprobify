# Get Credit Notes Against a Document

Returns the sum of all `AUTHORIZED` credit notes already issued against a given document, plus the remaining balance — so the caller can enforce "this credit note can't exceed the original's remaining balance."

```
GET /v1/documents/:accessKey/credit-notes
```

`:accessKey` is the access key of the **original document being credited** (typically an invoice), not a credit note's own key.

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (UUID from `GET /v1/issuers`)

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the original document |

## Response

**200 OK**

```json
{
  "ok": true,
  "originalDocument": { "accessKey": "1503202601179234567800110010010000000011234567810", "total": "115.00" },
  "creditedTotal": "30.00",
  "remaining": "85.00",
  "creditNotes": [
    { "accessKey": "0104202601179234567800110010010000000121234567810", "sequential": "000000012", "total": "30.00", "issueDate": "01/04/2026" }
  ]
}
```

| Field | Description |
|---|---|
| `originalDocument.accessKey` | The document's own access key (echoed back) |
| `originalDocument.total` | The original document's total |
| `creditedTotal` | Sum of `total` across matched credit notes, `"0.00"` if none |
| `remaining` | `originalDocument.total - creditedTotal` |
| `creditNotes` | Each `AUTHORIZED` credit note referencing this document — lets the caller show "this document already has N credit note(s)" for transparency, not just the count |

Only `AUTHORIZED` credit notes count toward `creditedTotal`. Credit notes still `SIGNED`/`RECEIVED` (pending) or `RETURNED`/`NOT_AUTHORIZED` (rejected) are excluded — they were never legally issued against the original.

::: warning Known limitation
Two credit notes created back-to-back, before the first one authorizes, won't see each other in this sum — there's no locking against concurrent credit note creation. Treat `remaining` as a UI guard, not a hard guarantee against over-crediting.
:::

## Errors

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | `accessKey` is not exactly 49 digits |
| `BAD_REQUEST` | 400 | `X-Issuer-Id` header missing or malformed |
| `UNAUTHORIZED` | 401 | Missing or invalid API key, or environment mismatch |
| `FORBIDDEN` | 403 | `X-Issuer-Id` issuer belongs to a different tenant |
| `NOT_FOUND` | 404 | `X-Issuer-Id` issuer does not exist |
| `NOT_FOUND` | 404 | Document not found |
