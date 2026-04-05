# Internal Server Error

**Code:** `INTERNAL_ERROR`
**Status:** `500 Internal Server Error`

An unexpected error occurred on the server. This is not caused by the request content.

## Response

```json
{
  "type":     "https://novaej.gitbook.io/comprobify-api-docs/errors/internal-error",
  "title":    "Internal Server Error",
  "status":   500,
  "code":     "INTERNAL_ERROR",
  "instance": "/api/documents/1503.../send"
}
```

Note: `detail` is intentionally omitted to avoid leaking internal information.

## What to do

- Retry the request — transient failures often resolve on retry
- Use the `instance` path and the time of the request to correlate with server logs
- If the error persists, contact the API operator
