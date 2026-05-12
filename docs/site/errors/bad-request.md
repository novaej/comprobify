# Bad Request

**Code:** `BAD_REQUEST`
**Status:** `400 Bad Request`

The request is syntactically valid but cannot be processed in the current context. Common causes:

- Attempting a lifecycle operation on a document that is not in the required status (e.g. sending a document that is already `AUTHORIZED`)
- Retrying an email that was already sent without the `?force=true` flag
- Supplying conflicting parameters
- Uploading a corrupt P12 certificate file during registration
- Providing the wrong password for a P12 certificate during registration
- Missing or malformed `X-Issuer-Id` header on a document endpoint
- Attempting to revoke the API key currently being used to authenticate the request

## Response

```json
{
  "type":     "https://novaej.github.io/comprobify/errors/bad-request",
  "title":    "Bad Request",
  "status":   400,
  "code":     "BAD_REQUEST",
  "detail":   "Invalid state transition: AUTHORIZED → RECEIVED",
  "instance": "/api/documents/1503.../send"
}
```

## What to do

Read the `detail` field — it describes the specific reason. Check the current document `status` with [Get Document](../endpoints/get-document.md) and ensure the operation is valid for that status.

| Allowed operations by status | |
|---|---|
| `SIGNED` | Send to SRI |
| `RECEIVED` | Check authorization |
| `RETURNED` | Rebuild |
| `NOT_AUTHORIZED` | Rebuild |
| `AUTHORIZED` | Download RIDE, download XML, retry email |
