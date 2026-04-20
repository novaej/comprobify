# ADR-012: PostgreSQL Row-Level Security for Tenant Isolation

## Status
Accepted

## Date
2026-04-20

## Context

Tenant isolation — ensuring one issuer cannot read or modify another issuer's documents — is currently enforced exclusively at the application layer. Every model query contains `WHERE issuer_id = $1`, and every service passes `issuer.id` (from the authenticated `req.issuer`) down to the model. This works, but it is a single layer of defense: a bug that forgets the filter, or a new code path that bypasses it, could silently expose another tenant's data.

The five tables that carry tenant data are:

- `documents` — invoice rows (direct `issuer_id`)
- `document_line_items` — invoice line items (linked via `document_id`)
- `document_events` — audit trail (linked via `document_id`)
- `sequential_numbers` — per-issuer sequence counters (direct `issuer_id`)
- `api_keys` — per-issuer API credentials (direct `issuer_id`)

No request to add a second enforcement layer was blocking production, but the system is approaching the point of onboarding paying clients. A database-level guarantee is appropriate before that happens.

## Decision

Enable PostgreSQL Row-Level Security (RLS) on all five tenant-scoped tables. Each policy restricts row visibility to the current issuer by reading a transaction-local configuration variable:

```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

CREATE POLICY documents_isolation ON documents
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::bigint
  );
```

`FORCE ROW LEVEL SECURITY` makes the policy apply to the table owner as well, not just other roles. `USING` applies to both reads (SELECT) and writes (UPDATE/DELETE); PostgreSQL uses the same expression as `WITH CHECK` for INSERT when no separate `WITH CHECK` clause is provided.

**The `app.current_issuer_id` setting** is a transaction-local PostgreSQL configuration variable. It is set at the start of every authenticated code path using `set_config('app.current_issuer_id', $1, true)` (the third argument `true` scopes the setting to the current transaction, equivalent to `SET LOCAL`). The implementation lives in two new helpers added to `src/config/database.js`:

- `setIssuerContext(client, issuerId)` — call after `BEGIN` on an existing transaction client. The setting rolls back automatically if the transaction aborts, requiring no cleanup.
- `queryAsIssuer(issuerId, text, params)` — opens a mini-transaction (`BEGIN` / `set_config` / query / `COMMIT`) for non-transactional model reads that previously called `db.query()` directly.

**The null bypass** — when `app.current_issuer_id` is not set, `current_setting(..., true)` returns an empty string; `NULLIF('', '')` yields `NULL`; the `IS NULL` branch of the policy is `TRUE`, granting unrestricted access. This is intentional: three code paths are legitimately issuer-agnostic and authenticate by other means:

| Code path | Auth mechanism | RLS context |
|---|---|---|
| Mailgun webhook | HMAC-SHA256 (`MAILGUN_WEBHOOK_SIGNING_KEY`) | None — looks up doc by `email_message_id` |
| Admin API | `ADMIN_SECRET` constant-time comparison | None — cross-issuer operations (e.g. create issuer, revoke key) |
| Health check | None — `/health` is public | None — no tenant data touched |

**The application database user must not be a PostgreSQL superuser.** Superusers bypass RLS unconditionally, regardless of `FORCE ROW LEVEL SECURITY`. This is an operational requirement documented in `GETTING_STARTED.md` and `docs/deployment.md`.

**Child tables** (`document_line_items`, `document_events`) do not have a direct `issuer_id` column. Their policy uses an `IN` subquery into `documents`:

```sql
CREATE POLICY document_events_isolation ON document_events
  AS PERMISSIVE FOR ALL
  USING (
    NULLIF(current_setting('app.current_issuer_id', true), '') IS NULL
    OR document_id IN (
      SELECT id FROM documents
      WHERE issuer_id = NULLIF(current_setting('app.current_issuer_id', true), '')::bigint
    )
  );
```

The `documents.issuer_id` column is indexed (`idx_documents_issuer_id`), so the subquery is efficient.

## Consequences

### Positive
- Defense-in-depth: a SQL bug that omits `WHERE issuer_id = $1` cannot expose another tenant's data — the database enforces the policy independently of application code.
- No ORM or framework dependency: RLS is a native PostgreSQL feature that works regardless of how queries are issued (raw pg, future ORM migration, administrative psql sessions).
- Automatic rollback on transaction abort: `set_config` with `is_local = true` means the issuer context is always undone if the transaction rolls back — no risk of a "leaked" context on pool connection reuse.
- The existing application-layer `WHERE issuer_id = $1` filters remain in place as the primary (and fast) filter. RLS is an additional check, not a replacement.

### Negative
- Every non-transactional read in an authenticated code path now requires a mini-transaction (`BEGIN` / `set_config` / query / `COMMIT`), adding two round-trips per standalone query (BEGIN + COMMIT).
- The null bypass means the webhook, admin, and health paths do not benefit from RLS protection. A SQL injection in those code paths could still read any tenant's data. Mitigated by: (a) those paths are short and separately authenticated, (b) the webhook only reads by `email_message_id` (globally unique), (c) the admin API is not exposed publicly.
- Superuser restriction must be enforced operationally — there is no code enforcement. A misconfigured deployment using the `postgres` superuser silently disables all RLS protections.
- Adding RLS to `sri_responses` (the remaining tenant-scoped table) was deferred; it was not in the original scope and is not read in any user-facing API path.

### Mitigation
- The mini-transaction overhead is negligible (< 1 ms per round-trip on a local or low-latency connection). For `findByIssuerId` (which already needed two queries for count + data), both queries are now batched in a single client transaction, improving consistency at the same cost.
- A database connection health check in `docs/deployment.md` and `GETTING_STARTED.md` documents the non-superuser requirement explicitly.

### Alternatives Considered

- **Application-layer filtering only (status quo):** No additional overhead, but a single code defect is sufficient to expose cross-tenant data. Rejected as insufficient before onboarding paying clients.

- **Separate PostgreSQL schema per tenant:** Each issuer's tables live in a dedicated schema; `search_path` is set to the issuer's schema at request start. Provides strong isolation and allows truncating test data per tenant. Rejected because: schema creation and migration must run per tenant (N issuers × M migrations), DDL becomes operationally complex, and this approach was already evaluated and deferred in the NEXT_STEPS.md sandbox environment discussion (item 4) where per-request `search_path` switching is planned for sandbox vs. production isolation, not tenant isolation.

- **Separate database per tenant:** Maximum isolation but operationally impractical — each tenant requires its own connection pool, migration pipeline, and backup regime. Connection count grows linearly with tenant count. Rejected for a multi-tenant SaaS context.

- **PostgreSQL role per tenant:** Create one database role per issuer, grant row ownership accordingly. RLS would use `CURRENT_USER` instead of a session variable. Rejected because PostgreSQL roles are a global, persistent resource — creating and dropping them at issuer onboarding/offboarding is fragile, and connection pools cannot trivially switch roles mid-session.

- **Strict RLS with no null bypass:** Remove the `IS NULL` branch so that the webhook, admin, and health paths also require issuer context. Rejected because the webhook has no issuer at the point of its initial `email_message_id` lookup, and the admin API is inherently cross-issuer by design. Supporting them would require either a SECURITY DEFINER PostgreSQL function (adds schema complexity) or a second privileged database connection (adds operational complexity). The null bypass is the simpler tradeoff given the separate authentication mechanisms in those paths.
