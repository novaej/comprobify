# Void Document

Marks an `AUTHORIZED` document as `VOIDED`. SRI has no SOAP service to void an already-authorized document — that cancellation happens on SRI's own portal. This endpoint only synchronizes the local record **after** you've already voided the document there — it does not call SRI or verify the cancellation actually happened.

```
POST /v1/documents/:accessKey/void
```

## Authentication

`Authorization: Bearer <api-key>` and `X-Issuer-Id: <issuer-id>` (UUID from `GET /v1/issuers`)

## Path parameters

| Parameter | Description |
|---|---|
| `accessKey` | The 49-digit access key of the document to void |

## Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `confirmedSriVoid` | boolean | Yes | Must be `true` — your explicit confirmation that you already voided this document in SRI's portal |
| `reason` | string | Yes | Reason for voiding (max 500 characters) — audit purposes only, never sent to SRI |

```json
{
  "confirmedSriVoid": true,
  "reason": "Duplicate invoice — customer already received the original 001-001-000000010"
}
```

## Response

**200 OK**

```json
{
  "ok": true,
  "document": {
    "accessKey": "1503202601179234567800110010010000000011234567810",
    "documentType": "01",
    "sequential": "000000001",
    "status": "VOIDED",
    "issueDate": "15/03/2026",
    "total": "115.00",
    "buyer": {
      "id": "1234567890",
      "idType": "05",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "voidReason": "Duplicate invoice — customer already received the original 001-001-000000010",
    "voidedAt": "2026-03-20T14:32:10.000Z",
    "email": {
      "status": "SENT"
    }
  }
}
```

## What doesn't change

- RIDE, XML, and the authorization email stay available unchanged — they're the frozen record of what SRI actually authorized.
- A voided document still **counts** toward the current month's stats (`GET /v1/documents/stats`) and the tenant's document quota — voiding corrects SRI's books, it doesn't undo the fact that the document was issued.
- Voiding is irreversible — `VOIDED` is a terminal status, same as `AUTHORIZED`.

## Errors

| Code | HTTP Status | When it happens |
|---|---|---|
| `VALIDATION_FAILED` | 400 | `reason` is missing, exceeds 500 characters, or `confirmedSriVoid` isn't a boolean |
| `DOCUMENT_VOID_CONFIRMATION_REQUIRED` | 400 | `confirmedSriVoid` isn't `true` |
| `BAD_REQUEST` | 400 | The `X-Issuer-Id` header is missing or malformed |
| `UNAUTHORIZED` | 401 | Missing/invalid API key, or environment mismatch |
| `FORBIDDEN` | 403 | The issuer in `X-Issuer-Id` belongs to another tenant, or the API key lacks the `documents:void` scope |
| `NOT_FOUND` | 404 | The issuer in `X-Issuer-Id` does not exist |
| `NOT_FOUND` | 404 | Document not found |
| `DOCUMENT_NOT_AUTHORIZED` | 400 | The document isn't in `AUTHORIZED` status (including already being `VOIDED`) |
