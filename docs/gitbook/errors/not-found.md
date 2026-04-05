# Not Found

**Code:** `NOT_FOUND`
**Status:** `404 Not Found`

The requested document does not exist, or it belongs to a different issuer than the one authenticated by the API key.

## Response

```json
{
  "type":     "https://docs.comprobify.com/errors/not-found",
  "title":    "Not Found",
  "status":   404,
  "code":     "NOT_FOUND",
  "detail":   "Document not found",
  "instance": "/api/documents/0000000000000000000000000000000000000000000000000"
}
```

## What to do

- Verify the access key is correct — it must be exactly 49 digits
- Confirm you are using the API key for the issuer that created the document
