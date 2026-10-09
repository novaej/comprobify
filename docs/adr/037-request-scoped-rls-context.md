# ADR-037: Request-Scoped RLS Context and Shadow Mode

## Status
Accepted

## Date
2026-10-09

## Context

[ADR-036](036-fail-closed-row-level-security.md) made RLS fail closed on the five document tables. Seventeen tenant-owned tables still have none: `tenants`, `issuers`, `api_keys`, `payments`, `subscriptions`, `notifications` and the rest rely entirely on `WHERE tenant_id = $1` in application code.

ADR-036 worked by wrapping about ten call sites by hand in `queryAsIssuer` / `queryAsSystem`. The tenant-owned tables are reached by roughly 170 queries in 17 model files. Wrapping each by hand does not scale, and a missed wrap is exactly the bug RLS exists to catch.

There is also no staging environment, and a missing context is easy to miss in review. Enforcing policies on tables that sit on every request's login path, with no way to observe gaps first, was not acceptable.

## Decision

**Context is declared once per request or job, not per query.** `src/config/rls-context.js` holds an `AsyncLocalStorage` store: `{ tenantId }` or `{ system: true }`. `db.query()` reads it and, when one exists, runs the query inside a transaction that sets `app.current_tenant_id` / `app.rls_system` locally. Models do not change.

| Entry point | Context |
|---|---|
| `authenticate` | system for the key lookup and `touchUsage`, then the tenant for everything downstream |
| `/v1/admin/*`, including every cron job | system (`systemContext` middleware, router level) |
| `/v1/register`, `/recover`, `/resend-verification`, `/verify-email`, `/verify-email/check` | system, set per route (the router is mounted at `/`) |
| `/v1/mailgun/webhook` | system |
| `pendingEffectService.process()` | system to claim and book-keep, the effect's own `tenant_id` for the handler |
| `db/migrate.js`, `scripts/rotate-encryption-key.js` | system |

Explicit transactions call `db.applyContext(client)` right after `BEGIN`. The issuer helpers from ADR-036 are unchanged for callers; they now also carry the ambient tenant, so a document transaction can update `tenant_quotas`. They never inherit system context.

**Shadow mode before enforcement.** This release adds no policies. When `db.query()` runs with no context against a tenant-owned table, or a transaction applies none, it logs `rls_context_missing` with the query site and its callers, once per site per process. Production traffic then shows which paths were missed, before a policy can break them. Policies follow in later releases, table group by table group.

## Consequences

### Positive
- Adding a query to a tenant route needs no RLS code; the context is already there.
- Cross-tenant reach is confined to a short, tested list of entry points (`tests/unit/routes/system-context-routes.test.js`).
- Gaps are observable in production at no risk.

### Negative
- Every query that has a context is now four statements (`BEGIN`, `set_config`, the query, `COMMIT`) where it was one, on every table, including ones that will never have RLS. They are pipelined (`pipeline: true` on the pool, `pg` ≥ 8.23), so they cost one network round-trip, not four; measured locally the wrapped query takes about as long as a bare one. Pipeline mode is new in the driver, which is a reason this ships before any policy depends on it.
- The context is implicit. A new entry point that touches tenant data and declares nothing works today and fails once policies are enforced; shadow mode is what catches it in the meantime.
- Shadow mode cannot see a query that has a context but the wrong one, such as tenant-context code reading another tenant's row on purpose. Those need a code audit and two-tenant tests before each enforcing release.
- The table list behind the warning is a regex over the SQL text. It is a reporting aid only and must never be used to decide enforcement.

## Alternatives considered

- **Wrap each query by hand**, as ADR-036 did. Rejected on size and on the cost of a missed one.
- **Four sequential round-trips per query**, the first implementation. About 2.5 times slower than a bare query locally, and worse over a real network; replaced by pipelining before release.
- **One connection and transaction per request.** Fewer round-trips, but holds one of five pooled connections for the whole request.
- **Audit-mode policies** that allow everything but raise a notice on a mismatch. Would also catch wrong-context reads; more moving parts. Worth revisiting if the code audit proves insufficient.
