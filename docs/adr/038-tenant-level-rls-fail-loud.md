# ADR-038: Tenant-Level RLS Policies, Fail-Loud

## Status
Accepted

## Date
2026-10-09

## Context

[ADR-037](037-request-scoped-rls-context.md) gave every request and job a declared context without enforcing anything. This ADR records the first enforcement step and one change to how a missing context behaves.

Under [ADR-036](036-fail-closed-row-level-security.md) a query with no context returned nothing. That is safe, but it is quiet: a status update that matches zero rows reports success, so a missed context shows up as something that stopped happening, possibly weeks later. The 1.3.0 rollout depended on finding every such path by reading code.

## Decision

**Eleven tenant-owned tables get policies** (migration 106), keyed on `app.current_tenant_id`:

- direct `tenant_id`: `notifications`, `notification_preferences`, `webhook_endpoints`, `webhook_deliveries`, `tenant_events`, `tenant_agreements`, `subscriptions`, `tenant_quotas`
- through the subscription: `payments`, `payment_proofs`, `payphone_transactions`

The identity tables (`tenants`, `issuers`, `api_keys`, their children) and `pending_effects` follow in a later release. They sit on the login path of every request.

**A missing context is an error, not an empty result.** Policies call `app_require_tenant_id()` / `app_require_issuer_id()`, which raise `42501` with a message starting `RLS: no tenant or system context` when neither their own setting nor the system flag is set. The document tables from migration 105 are recreated with the same rule.

```sql
USING (public.app_is_system() OR tenant_id = public.app_require_tenant_id())
```

The system check is repeated *inside* the `app_require_*` functions. Postgres evaluates both sides of the `OR`, so a function that raised whenever its own setting was unset would also raise in system context. This was found by prototype, not by reasoning.

The two kinds of context do not substitute for each other: a tenant context alone does not open a document table, and an issuer context alone does not open a tenant table. `setIssuerContext` carries the ambient tenant so one transaction can do both.

## Consequences

### Positive
- A forgotten context is a 500 with a named cause in Sentry on first use, instead of silent data loss.
- Ownership checks in the billing and messaging code are now backed by the database: a tenant asking for another tenant's payment by id finds nothing.
- `tests/integration/http-two-tenants.test.js` drives the real app as two tenants with the policies on, and fails if any query ran without a context.

### Negative
- A missed path now fails requests outright. Shadow mode (ADR-037) and the HTTP tests are the mitigation; the rollback script is the remedy.
- Fail-loud holds whenever a row is examined. A query Postgres can prove returns nothing (a contradictory `WHERE`) may return empty without raising. Nothing leaks either way.
- Ad-hoc SQL as `comprobify_app` now gets an error on these tables rather than an empty grid. The error's hint says what to set.
- A request for another tenant's resource by id now returns "not found" from the query itself. Every route covered so far already answered 404 in that case.

### Rollout and rollback
The code that declares contexts shipped first (1.3.1), so the running containers are already compatible when migration 106 applies. The migration takes an exclusive lock on 21 tables; the 10-second lock timeout applies, so SQL clients must be disconnected from production first. `db/rollback/106_tenant_rls_messaging_billing.sql` removes the new policies and returns the document tables to migration 105's behavior. The application runs unchanged on either.
