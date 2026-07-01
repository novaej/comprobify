# Agreements

Returns the currently published agreements (Terms of Service, Privacy Policy, DPA). These are the documents a tenant accepts at signup. Use these endpoints to display the documents in your registration flow.

## List current documents

```
GET /v1/agreements
```

**Authentication:** None — public endpoint, no rate limit.

### Response

```json
{
  "ok": true,
  "documents": [
    { "documentType": "TERMS", "version": "2026-06-28", "url": "/v1/agreements/TERMS" },
    { "documentType": "PRIVACY", "version": "2026-06-28", "url": "/v1/agreements/PRIVACY" },
    { "documentType": "DPA", "version": "2026-06-28", "url": "/v1/agreements/DPA" }
  ]
}
```

The `version` string is what you pass as `termsVersion` in `POST /v1/register` (or `POST /v1/tenants/agreements`). Always read it from this response rather than hardcoding it — the server validates against whatever is currently published.

## Get a document

```
GET /v1/agreements/:type
```

**Authentication:** None — public endpoint, no rate limit.

**URL parameter:** `:type` must be one of `TERMS`, `PRIVACY`, or `DPA`.

Returns the document rendered as `text/html`. Embed it in an iframe, modal, or full page in your registration UI.

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `:type` is not a valid document type |
| `404` | `AGREEMENT_NOT_FOUND` | No document of that type has been published yet |

## Notes

- The TERMS and PRIVACY documents together make up the acceptance bundle. The DPA is incorporated by reference in the Terms of Service — there is only one checkbox in the UI, not three.
- The `version` value from `GET /v1/agreements` is an opaque string token. The server does not interpret its format — it just checks that the version you present at acceptance time matches what was current when the user clicked accept.
- If nothing has been published yet, `GET /v1/agreements` returns an empty array and registration does not enforce a `termsVersion` match (pre-launch fallback).
