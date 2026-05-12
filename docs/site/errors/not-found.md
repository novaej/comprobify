# Not Found

**Code:** `NOT_FOUND`
**Status:** `404 Not Found`

The requested resource does not exist, or it belongs to a different issuer than the one named by the `X-Issuer-Id` header. Common cases: an access key that does not match any document for the targeted issuer, or an issuer id that is inactive or never existed.

## Response

```json
{
  "type":     "https://novaej.github.io/comprobify/errors/not-found",
  "title":    "Not Found",
  "status":   404,
  "code":     "NOT_FOUND",
  "detail":   "Document not found",
  "instance": "/api/documents/0000000000000000000000000000000000000000000000000"
}
```

## What to do

- Verify the access key is correct — it must be exactly 49 digits
- Confirm `X-Issuer-Id` names the issuer that created the document — list all of your tenant's issuers with `GET /api/issuers`
