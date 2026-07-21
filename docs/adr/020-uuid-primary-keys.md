# ADR-020: UUID Primary Keys

## Status
Accepted

## Date
2026-07-21

## Context

Every table used an integer `SERIAL`/`BIGSERIAL` primary key (widened from `INTEGER` to `BIGINT` once already, in migration `030_bigint_primary_keys.sql`). Auto-increment ids create predictable, enumerable identifiers exposed directly in API responses and the `X-Issuer-Id` header, and they don't generalize cleanly to future scaling scenarios (multi-region writes, merging data across environments, id collisions like the existing `sandbox.documents`/`public.documents` independent-sequence issue documented in CLAUDE.md's subscription pipeline section).

This was a pre-launch decision — no production data existed to migrate, which made a direct schema rewrite viable instead of a live backfill.

## Decision

**Every table's primary key is `UUID PRIMARY KEY DEFAULT uuid_generate_v7()`, and every foreign key matches its target's `UUID` type. No integer PK/FK remains anywhere in the schema.**

- **UUIDv7, not v4.** UUIDv7 embeds a 48-bit millisecond timestamp in its leading bytes, so values sort chronologically — this preserves two behaviors the codebase already depended on under `SERIAL`: `ORDER BY id` as an implicit "insertion order" (`issuer.model.js`, `tenant.model.js`), and "everything after id X" cursor polling (`GET /v1/notifications?sinceId=`). A random UUIDv4 would have broken both and degraded B-tree index locality on high-insert tables (`documents`, `sequential_numbers`) besides.
- **Hand-rolled generator, not a native function.** PostgreSQL's built-in `uuidv7()` only ships in version 18+; the project's target is 14.x minimum (`GETTING_STARTED.md`). `db/migrations/000_uuid_v7_function.sql` implements the standard recipe in PL/pgSQL — a 48-bit ms timestamp followed by `pgcrypto`'s `gen_random_bytes(10)`, with the version/variant bits set per RFC 9562 — set as the `DEFAULT` on every table's `id` column. This keeps every model's existing `INSERT ... RETURNING id` code completely unchanged; Postgres fills in the id exactly like `SERIAL` did.
- **Migrations edited in place, not squashed.** CLAUDE.md's Key Files table and dozens of prose passages cite specific migration numbers ("migration 073", "044–047: notifications + webhooks", etc.). Rewriting history into a fresh consolidated set would have forced a large, error-prone rewrite of those cross-references for no functional benefit (there was no data to preserve either way). Instead, `UUID PRIMARY KEY DEFAULT uuid_generate_v7()` was baked directly into each table's **original** `CREATE TABLE` migration, and `030_bigint_primary_keys.sql` — now moot, since there's no `INTEGER`→`BIGINT` widening left to do — was deleted. Every other migration number, filename, and documented behavior is unchanged.
- **Fixed a latent type inconsistency along the way.** Six FK columns (`notifications.tenant_id`/`issuer_id`, `notification_preferences.tenant_id`, `webhook_endpoints.tenant_id`, `webhook_deliveries.tenant_id`, `tenant_legal_documents.tenant_id`) were declared `INTEGER` even though they referenced `BIGINT` primary keys — a pre-existing mismatch, invisible under Postgres's implicit int4→int8 comparison. Converting to `UUID` uniformly at each column's origin migration resolved this without any special-casing.
- **No new runtime dependency.** `express-validator`'s `.isUUID()` was already available for validating route params; nothing in the app needs to generate a UUID client-side (SRI access-key generation, RIDE PDF rendering, and idempotency-key handling are all built from business fields, never the DB PK — confirmed unaffected by this change).

## Consequences

### Positive
- Ids are no longer sequential/enumerable, and the schema is one step closer to safely supporting multi-region or merged-environment writes without collision risk (the `sandbox.documents`/`public.documents` independent-sequence gap CLAUDE.md already flags becomes structurally impossible to worsen).
- `ORDER BY id` and cursor-based polling continue to behave exactly as before, since UUIDv7 preserves chronological ordering.
- Business logic (access-key generation, RIDE rendering, sequential-number locking) required zero changes — none of it ever depended on the integer PK.

### Negative / follow-up
- UUID string ids are 36 bytes vs. 8 for `BIGINT`, a modest storage and index-size cost across every table.
- Every `.isInt({min:1})` validator, `parseInt(req.params.id)` controller call, and hardcoded integer test fixture touching a PK/FK had to be swept and converted — a large, one-time mechanical migration (~30 validators, ~27 controller call sites, ~800 test fixture literals).
- `api_keys.id`/`tenants.id`/etc. now appear as UUID strings in every API response — a breaking change for any existing API consumer, called out in `CHANGELOG.md`.
