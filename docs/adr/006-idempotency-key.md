# ADR-006: Idempotency Key for Invoice Creation

## Status
Accepted

## Date
2026-03-01

## Context

`POST /api/invoices` is not idempotent by design — every call creates a new invoice with a new sequential number and access key. Network timeouts, client retries, and background queue workers can therefore produce duplicate invoices. With email delivery live, each duplicate invoice also fires a duplicate notification to the buyer.

The fix must satisfy three constraints:

1. **No sequential waste** — a replayed request must return the existing document, not consume a new sequential number.
2. **Correctness under concurrency** — two simultaneous requests with the same key must produce exactly one invoice.
3. **No silent collisions** — reusing a key with a different payload must be an explicit error, not a silent override.

## Decision

Accept an `Idempotency-Key` HTTP request header on `POST /api/invoices`. The key is caller-supplied (e.g. an internal order ID or UUID). The API stores the key and a SHA-256 hash of the request body in two new nullable columns on `documents` (`idempotency_key`, `payload_hash`). A partial unique index (`WHERE idempotency_key IS NOT NULL`) enforces uniqueness at the database level.

**Lookup flow (before opening any transaction):**
1. If no key → proceed normally (no idempotency tracking).
2. If key found and hashes match → return existing document with HTTP 200 (replay).
3. If key found and hashes differ → throw `ConflictError` 409.
4. If key not found → compute hash, proceed with creation, store key + hash in the `INSERT`.

**Concurrent race handling:** Two concurrent requests can both pass the pre-transaction lookup (neither row exists yet) and race to `INSERT`. The partial unique index ensures only one succeeds. The loser catches Postgres error `23505` in the transaction rollback handler, fetches the winner row, and returns it as a 200 replay — the caller gets the correct response instead of a 500.

## Consequences

### Positive
- Network retries from HTTP clients and queue workers are safe — no duplicate invoices, no duplicate emails.
- The check runs before opening a transaction for known replays — zero sequential lock contention for repeated calls.
- Payload hash comparison is O(1) (string compare) regardless of invoice body size.
- The partial unique index keeps the constraint lightweight — existing rows without keys are never compared against each other.

### Negative
- Callers must generate and store a unique key per intended invoice. Callers that do not send the header get no protection (idempotency is opt-in).
- The SHA-256 hash is sensitive to JSON key ordering — if the caller reorders body fields between retries, the hash will differ and a 409 will be returned even though the intent is identical.

### Mitigation
- The `Idempotency-Key` header is optional — existing integrations continue to work without changes.
- JSON key ordering: callers should construct the body deterministically (e.g. from a typed object or schema), which is the normal pattern for any structured API integration.

### Alternatives Considered
- **Body field (`idempotencyKey`)**: Rejected — would require changes to the validator chain, would appear in the stored `request_payload` JSONB, and would bleed into the hash computation (a field that is part of the payload cannot also be excluded from the hash it guards).
- **Per-issuer unique constraint (composite key)**: Rejected — the codebase currently has a single issuer (`issuerModel.findFirst()`). A global unique index is simpler and can be changed to a composite index when multi-issuer support is added.
- **Full payload deep-equality**: Rejected — requires fetching the stored JSONB and deserialising it on every retry. A 64-character hex hash stored in a `TEXT` column achieves the same result in O(1).
- **Idempotency handled in middleware**: Rejected — the check must run inside (or just before) the DB transaction to be consistent. A middleware layer would violate the architecture rule that only services touch models.
