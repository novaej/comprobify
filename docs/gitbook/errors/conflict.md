# Conflict

**Code:** `CONFLICT`
**Status:** `409 Conflict`

An `Idempotency-Key` header was supplied with a value that has already been used for a different request payload.

## Response

```json
{
  "type":     "https://docs.comprobify.com/errors/conflict",
  "title":    "Conflict",
  "status":   409,
  "code":     "CONFLICT",
  "detail":   "Idempotency key already used with a different payload",
  "instance": "/api/documents"
}
```

## What to do

Each `Idempotency-Key` must be unique per intended invoice. If you are retrying the same invoice after a failure, reuse the **same key and the same payload** — the API will return the existing document.

If you intended to create a new invoice, generate a fresh idempotency key (e.g. a new UUID).
