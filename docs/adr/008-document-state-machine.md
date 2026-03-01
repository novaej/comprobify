# ADR-008: Document State Machine

## Status
Accepted

## Date
2026-03-01

## Context

Document status guards were scattered through `document.service.js` as manual `if (status !== X)` checks:

```js
if (document.status !== 'SIGNED') {
  throw new AppError(`Cannot send document with status ${document.status}. Must be SIGNED.`, 400);
}
```

There was no canonical description of the allowed state graph — it was implicit in the code. There was also no database-level protection preventing a buggy code path from writing an invalid status transition directly to the DB.

The document lifecycle follows strict rules mandated by SRI's protocol:

- A document must be `SIGNED` before it can be sent.
- A document must be `RECEIVED` before authorization can be checked.
- Only `RETURNED` and `NOT_AUTHORIZED` documents can be rebuilt (same access key, fresh XML).
- `AUTHORIZED` is a terminal state — no further lifecycle transitions are allowed.

## Decision

Dual-layer enforcement: application-level state machine + PostgreSQL trigger.

**Application layer (`src/constants/document-state-machine.js`):**

```
TRANSITIONS = {
  SIGNED:         [RECEIVED, RETURNED],
  RECEIVED:       [AUTHORIZED, NOT_AUTHORIZED],
  RETURNED:       [SIGNED],
  NOT_AUTHORIZED: [SIGNED],
  AUTHORIZED:     [],          ← terminal
}
```

`assertTransition(from, to)` throws `AppError(400)` with `"Invalid state transition: X → Y"` if the transition is not in the allowed graph. Called at the top of each service operation.

`canTransition(from, to)` exposes the same lookup as a boolean predicate for use in tests and conditional logic.

**Database layer (migration 027, `trg_document_state_transition`):**

A PL/pgSQL `BEFORE UPDATE` trigger validates every `status` change against the same allowed graph. If the application layer is bypassed (direct SQL, a bug, a future service that forgets to call `assertTransition`), the DB rejects the write with a `RAISE EXCEPTION`.

**Migration 026 (`trg_document_immutability`) additionally enforces:**

- Permanently immutable columns: `access_key`, `sequential`, `issuer_id`, `document_type`, `issue_date`, `branch_code`, `issue_point_code` — set on `INSERT`, never changed.
- Set-once columns: `authorization_xml`, `authorization_number`, `authorization_date` — `NULL → value` allowed; `value → different value` rejected.
- Rebuild-gated columns: `unsigned_xml`, `signed_xml`, `request_payload` — can only change when `status` is transitioning to `SIGNED` (rebuild path).

**Model-layer column whitelist (`document.model.js` `updateStatus`):**

The `updateStatus` function rejects calls that pass unknown column names in `extraFields`. This catches typos and accidental new columns before they reach the DB.

## Consequences

### Positive
- The complete allowed graph is documented in one file (`document-state-machine.js`).
- Services no longer contain ad-hoc status checks — they call one function.
- `canTransition(from, to)` is a testable predicate.
- Invalid transitions are impossible to persist even via direct SQL.
- Set-once authorization fields (`authorization_number`, `authorization_xml`) cannot be overwritten by a bug.

### Negative
- New legitimate transitions require updates in two places (JS constants + SQL trigger).
- The DB trigger adds a small overhead to every `UPDATE documents` row.

### Mitigation
Both the JS constants and the SQL trigger follow the same simple `(from, to)` pair pattern. Adding a new transition is a mechanical 2-line change. The trigger overhead is negligible — it runs PL/pgSQL branch checks on already-loaded row data.

### Alternatives Considered
- **Application checks only (no DB trigger)**: Simpler, but leaves no defense against future bugs or direct DB access. Rejected for safety.
- **DB trigger only (no application checks)**: DB exceptions have poor error messages and would require bespoke error mapping in the Node error handler. Rejected for developer experience.
- **XState**: Full state machine library. Overkill for 5 states and 7 transitions — the graph is fully describable as a frozen plain object in 8 lines. XState adds a new paradigm (actors, guards, actions, services) with significant learning overhead and runtime footprint without proportional benefit for this domain.
- **Enum column constraint**: A PostgreSQL `CHECK` constraint can validate that `status` is a known value, but cannot enforce which transitions are valid between states. Insufficient on its own.
