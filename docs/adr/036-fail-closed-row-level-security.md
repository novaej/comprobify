# ADR-036: Fail-Closed Row-Level Security

## Status
Accepted

## Date
2026-10-07

## Context

[ADR-012](012-postgresql-row-level-security.md) put RLS on the issuer-scoped tables with a deliberate bypass: when `app.current_issuer_id` was unset, the policy's `IS NULL` branch let every row through. That let the Mailgun webhook, the admin API, and the health check run without an issuer.

The cost was that RLS only protected code paths that remembered to set the context. A new authenticated query using plain `db.query()` saw every tenant's rows and looked correct in any single-tenant test. To the database, a deliberate cross-tenant call and a forgotten context were the same thing. The same was visible from any SQL client: connecting as `comprobify_app` showed every tenant's documents.

Two further gaps: `public.sri_responses` had no RLS at all while `sandbox.sri_responses` did, and no test exercised the policies against a real database — every RLS-related test mocked `db`.

## Decision

**An unset context sees nothing.** Migration 105 recreates every policy without the bypass:

```sql
CREATE POLICY documents_isolation ON documents FOR ALL
  USING      (public.app_is_system() OR issuer_id = public.app_current_issuer_id())
  WITH CHECK (public.app_is_system() OR issuer_id = public.app_current_issuer_id());
```

- `app_current_issuer_id()` reads `app.current_issuer_id` (unchanged setting, `NULL` when unset — and `issuer_id = NULL` is never true).
- `app_is_system()` is true only when `app.rls_system` is exactly `'on'`.
- Child tables (`document_line_items`, `document_events`, `sri_responses`) use an `EXISTS` against their own schema's `documents`.
- Every policy has an explicit `WITH CHECK`, and `public.sri_responses` gains RLS.

**Cross-issuer access is explicit.** `db.queryAsSystem()` / `db.setSystemContext()` set `app.rls_system` transaction-locally, mirroring `queryAsIssuer` / `setIssuerContext`. A separate flag was chosen over a sentinel issuer id so the issuer setting only ever holds a real issuer.

System context is used in exactly these places:

| Code path | Why no issuer is known |
|---|---|
| `documentModel.findByEmailMessageId` (Mailgun webhook) | the message id is the only identifier; the follow-up writes run in the found document's issuer context |
| `documentModel.findByAccessKey(accessKey)` with no issuer (`linkInvoice`, admin RIDE) | operator lookup across tenants and schemas |
| `paymentModel.findAllByStatus` | admin payments list resolves `invoice_access_key` from either schema |
| `db/migrate.js` | data migrations; set at session level because some migration files issue their own `COMMIT` |

Everything else that used the bypass moved to issuer context — notably `sri-response.model.js`, which wrote sandbox SRI responses with no context at all.

**The policies are tested for real.** `tests/integration/rls-fail-closed.test.js` runs against a migrated Postgres as the non-superuser app role, in CI on every PR.

## Consequences

### Positive
- A forgotten context is a visible failure (empty result, rejected insert) instead of a silent cross-tenant read.
- The set of cross-issuer code paths is small, named, and greppable (`queryAsSystem`, `setSystemContext`).
- `sri_responses` is protected in both schemas.
- A new table with `issuer_id`/`document_id` and no RLS fails a catalog test.

### Negative
- Reads and updates fail *silently* (zero rows, no error) when the context is missing; only inserts raise. A missed call site shows up as something that quietly stopped happening.
- Ad-hoc SQL as `comprobify_app` returns nothing on these tables until `SET app.rls_system = 'on'` is run in the session.
- The system flag is a session setting, not a privilege: anything able to run arbitrary SQL as the app role can set it. RLS here guards against application bugs, not against a compromised database credential — the same trust model ADR-012 had.
- Tenant-level tables (`tenants`, `issuers`, `api_keys`, `payments`, `notifications`, …) still have no RLS and rely on application-layer filtering.

### Rollout and rollback
The converted code works under both the old and the new policies, so the migration can ship in the same release as the code. `db/rollback/105_rls_fail_open.sql` restores the previous policies by hand; it swaps policies only and touches no data.

## Alternatives considered

- **Sentinel issuer id for system access** (taxap's approach) — equivalent in strength; rejected only for readability.
- **A separate `BYPASSRLS` database role for admin paths** — a real privilege boundary, but needs a second connection pool and role management on the managed cluster. Worth revisiting if RLS is extended to tenant-level tables.
- **Request-scoped context via `AsyncLocalStorage`** so `db.query()` sets the context itself — the right mechanism for extending RLS to the ~17 tenant-level tables, deferred with that work.
