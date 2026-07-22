# SRI Submission Failed

**Code:** `SRI_SUBMISSION_FAILED`
**Status:** `502 Bad Gateway`

A network error occurred while communicating with the SRI SOAP service. This is distinct from SRI returning `RETURNED` or `NOT_AUTHORIZED` — those are successful communications where SRI rejected the document content, not network failures.

::: warning No longer returned in any HTTP response
Since the RabbitMQ-backed async SRI submission change, `POST /:key/send` and `GET /:key/authorize` never call SRI in-request — the actual SOAP call happens later, inside `workers/worker.js`, a standalone process with no HTTP client waiting on it. `SRI_SUBMISSION_FAILED` can therefore no longer appear as an RFC 7807 response body to any client. A network failure now surfaces as an `ERROR` row in the document's event trail (`GET /:accessKey/events`) instead — check there, not an HTTP response, when a document seems stuck. This page is kept for historical/API-code reference (the `SriError` class and this `code` value still exist internally), not as a response you should expect to parse.
:::

## Response (historical — before ADR-019)

```json
{
  "type":     "https://docs.comprobify.com/errors/sri-error",
  "title":    "SRI Submission Failed",
  "status":   502,
  "code":     "SRI_SUBMISSION_FAILED",
  "detail":   "SRI service unavailable",
  "instance": "/v1/documents/1503.../send",
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

## What to do now

- Check `GET /v1/documents/:accessKey/events` for an `ERROR` event with `operation: "SEND"` or `"AUTHORIZE"` and a `message` field describing the failure.
- A failed attempt doesn't need manual retry — `POST /v1/admin/jobs/queue-reconciliation` automatically re-publishes the document for another attempt by the worker.
- The SRI test environment (`celcer.sri.gob.ec`) is sometimes unavailable outside business hours.
