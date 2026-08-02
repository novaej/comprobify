# SRI Submission Failed

**Code:** `SRI_SUBMISSION_FAILED`
**Status:** `502 Bad Gateway`

SRI's own SOAP service responded with a non-2xx HTTP status (e.g. `500`) — a response was received, just not a valid one. This is a transport-level failure, distinct from SRI returning `RETURNED` or `NOT_AUTHORIZED` (successful communications where SRI rejected the document's content) — and also distinct from a genuine network failure (timeout, DNS, connection refused), which `sri.service.js` retries automatically up to 3 times before propagating the original, unwrapped error; that case never becomes a `SriError`/`502` at all.

A non-2xx status from SRI can mean two very different things, both surfaced identically here but distinguishable from the raw SOAP fault body (see "What to do now" below): a `soap:Client` fault (something about the request itself — envelope structure, encoding) versus a `soap:Server` fault (an internal failure on SRI's own infrastructure, e.g. a database error in their reception service) — the latter is typically transient and worth simply retrying, the former usually is not.

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
- Check `GET /v1/documents/:accessKey/sri-responses` too — a non-2xx failure is recorded there with `status: "HTTP_<code>"` (e.g. `"HTTP_500"`) alongside the actual RECEPTION/AUTHORIZATION rows. Unlike the short message in the event trail, this endpoint's row exists specifically so this raw SOAP fault body gets persisted (previously it was discarded entirely) — see [Get SRI Responses](../endpoints/get-sri-responses.md).
- A failed attempt doesn't need manual retry at first — `POST /v1/admin/jobs/queue-reconciliation` automatically re-publishes the document for another attempt by the worker, up to 5 attempts total (`PENDING_EFFECTS_MAX_ATTEMPTS`). If all 5 are exhausted, the document is stuck and you can recover it yourself — see [Retry Send/Authorize](../endpoints/retry-send.md).
- The SRI test environment (`celcer.sri.gob.ec`) is sometimes unavailable outside business hours, and — as the `soap:Client` vs `soap:Server` distinction above suggests — can also fail with internal server errors unrelated to the submitted document.
