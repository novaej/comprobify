# SRI Submission Failed

**Code:** `SRI_SUBMISSION_FAILED`
**Status:** `502 Bad Gateway`

A network error occurred while communicating with the SRI SOAP service. This is distinct from SRI returning `RETURNED` or `NOT_AUTHORIZED` — those are successful communications where SRI rejected the document content, not network failures.

## Response

```json
{
  "type":     "https://docs.comprobify.com/errors/sri-error",
  "title":    "SRI Submission Failed",
  "status":   502,
  "code":     "SRI_SUBMISSION_FAILED",
  "detail":   "SRI service unavailable",
  "instance": "/api/documents/1503.../send",
  "sriMessages": [
    {
      "identifier": "35",
      "message":    "ARCHIVO NO CUMPLE ESTRUCTURA XML",
      "type":       "ERROR"
    }
  ]
}
```

The `sriMessages` array contains the raw response messages from SRI when available.

## What to do

- If `sriMessages` is empty, the request did not reach SRI — retry after a short delay
- If `sriMessages` is present, SRI returned an error code — check the `message` field for the rejection reason
- The SRI test environment (`celcer.sri.gob.ec`) is sometimes unavailable outside business hours
