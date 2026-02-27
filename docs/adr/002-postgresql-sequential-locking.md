# ADR-002: PostgreSQL SELECT FOR UPDATE for Sequential Numbers

## Status
Accepted

## Date
2026-02-26

## Context

SRI requires each electronic document to have a unique 9-digit sequential number per issuer/branch/issue-point/document-type combination. Duplicate sequential numbers cause SRI to reject documents with an error that is difficult to recover from — the duplicate invoice cannot be resubmitted with the same access key.

The original implementation stored sequential counters in a flat JSON file on disk. This works for a single process but fails silently under any concurrent load: two simultaneous requests could both read the same value, both compute the same next number, and generate duplicate invoices.

The replacement needed to be concurrency-safe without requiring an external service.

## Decision

Store sequential counters in a PostgreSQL `sequential_numbers` table and increment them inside an explicit transaction using `SELECT ... FOR UPDATE`:

```sql
BEGIN;
SELECT current_value FROM sequential_numbers
  WHERE issuer_id = $1 AND branch_code = $2
    AND issue_point_code = $3 AND document_type = $4
  FOR UPDATE;              -- blocks concurrent reads on this row
UPDATE sequential_numbers SET current_value = $5 ...;
COMMIT;
```

The `FOR UPDATE` clause acquires a row-level lock. Any concurrent transaction attempting to read the same counter row will block until the first transaction commits, guaranteeing sequential and unique increments.

The counter row is auto-created on first use via an `INSERT` fallback when the `SELECT` returns no rows, so no pre-seeding is required.

## Consequences

### Positive
- Guaranteed uniqueness under any level of concurrency — no application-level locking needed
- Leverages the same PostgreSQL connection the rest of the application already uses — no extra infrastructure
- Transactional: if the invoice fails after the counter is incremented, the transaction rolls back and the number is not consumed
- Row-level lock is granular — only the specific issuer/branch/point/docType row is locked, not the entire table

### Negative
- Sequential number generation serialises requests for the same counter — under very high concurrent load this becomes a bottleneck for that specific counter row
- Requires an explicit client connection (not pool auto-management) for the transaction duration

### Mitigation
The serialisation bottleneck is acceptable for the expected load — electronic invoicing is not a high-frequency operation. If throughput ever becomes a concern, the counter could be pre-allocated in batches (fetch N numbers at once and hand them out in memory), but this adds complexity and is not needed today.

### Alternatives Considered
- **PostgreSQL SERIAL / SEQUENCE**: A database sequence auto-increments atomically without a transaction. Rejected — SRI sequentials are scoped per issuer/branch/point/docType combination, requiring a separate sequence per combination, which is impractical to manage dynamically.
- **Redis atomic increment (INCR)**: Atomic and fast. Rejected — introduces a new infrastructure dependency (Redis) for a single feature, and the project already has PostgreSQL.
- **UUID-based identifiers**: Avoids the sequential problem entirely. Rejected — SRI mandates a 9-digit sequential numeric format; UUIDs cannot be used.
- **Optimistic locking with retry**: Read-then-update with a version check, retry on conflict. Rejected — more complex to implement correctly than `FOR UPDATE` and has no advantage here.
