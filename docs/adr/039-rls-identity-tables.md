# ADR-039: RLS on the Identity Tables and the Effects Outbox

## Status
Accepted

## Date
2026-10-10

## Context

After [ADR-038](038-tenant-level-rls-fail-loud.md), six tables that hold tenant data still had no Row-Level Security: `tenants`, `issuers`, `api_keys`, `api_key_daily_usage`, `issuer_document_types` and `pending_effects`. They were left for last because they sit on the path of every request: `authenticate` reads `api_keys` and `tenants` before anything else runs, and `resolveIssuer` reads `issuers` on every document call.

`api_keys` had RLS once. Migration 042 removed it, because authentication happens before any tenant is known and there was no way to express that. [ADR-037](037-request-scoped-rls-context.md)'s system context is that way.

## Decision

**Migration 107 puts all six under the same fail-loud policies** as migration 106:

- `tenants` (`id`), `issuers`, `api_keys`, `pending_effects` (`tenant_id`)
- `issuer_document_types` through its issuer, `api_key_daily_usage` through its key
- an index on `issuers (tenant_id)`, which the policy now filters on for every request and nothing indexed

Every table that carries tenant data is now protected. `tests/integration/rls-fail-closed.test.js` asserts that no table with an owner column lacks RLS, with no exceptions listed.

**Ownership lookups that must answer 403 run in system context.** A request naming another tenant's issuer has always returned `403 ISSUER_FORBIDDEN` and recorded an attempt. Under RLS that row is invisible to the caller, so the lookup would return nothing and the answer would become 404. `resolveIssuer` and `issuer.controller.js`'s two loaders therefore read the issuer inside `rlsContext.runAsSystem`, then apply the explicit `tenant_id` check they already had. The lookup is by primary key and nothing from it is returned before that check passes.

No other application code changed. The harness found this one case and no others.

## Consequences

### Positive
- A missing `WHERE tenant_id` anywhere in the codebase can no longer expose another tenant's issuers, certificates, API key records or queued effects.
- `api_keys` is protected again, six months after RLS was removed from it.
- `tests/integration/http-two-tenants.test.js` now covers the whole application surface as two tenants, including signed document flows, branch creation, rebuild and promotion, with every policy on.

### Negative
- The three system-context lookups are a deliberate, narrow hole: code between the lookup and the ownership check sees a foreign issuer row. Each is three lines and unit-tested, but they must stay that way.
- Shadow mode has nothing left to observe quietly. The `rls_context_missing` warning is kept because it names the calling code, which the database error does not.
- Account-lifecycle routes (register, recover, verify) run entirely in system context, so RLS does not constrain them. They are pre-tenant by nature and gated by the internal-service secret.
- Automated tests do not cover registration, recovery or certificate renewal (they need a real P12) or Payphone (needs the vendor).

### Rollout and rollback
The migration takes an exclusive lock on six tables that every request reads. The 10-second lock timeout applies; SQL clients must be disconnected from production first. `db/rollback/107_tenant_rls_identity.sql` removes the six policies. The application runs unchanged on either.
