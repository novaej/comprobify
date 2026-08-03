# ADR-026: Redis for Shared Rate-Limiting and Repeated-Attempt Counters

## Status
Accepted

## Date
2026-08-03

## Context

`src/middleware/rate-limit.js` used `express-rate-limit`'s default in-memory store from the very first rate-limiting implementation. That store is correct only for a single API instance — each instance keeps its own counter, so running N instances lets a tenant/IP burst to roughly `limit × N` before any single instance throttles them. This was a latent bug: harmless while the API only ever ran as one instance (the case today), but it would silently under-enforce the moment horizontal scaling — even just multiple `api` container replicas on the same droplet — became necessary.

Separately, closing a registration-recovery account-takeover gap (`POST /v1/recover`, see ADR-021's addendum) surfaced a related need: several sensitive code paths (repeated successful recoveries for the same tenant, repeated invalid API keys, repeated wrong `ADMIN_SECRET` values, repeated invalid Mailgun webhook signatures) all needed the same shape of mechanism — a shared, short-lived counter per `(event, key)` pair, crossing a threshold within a window, to flag a repeated-attempt pattern as a signal for the operator. This is explicitly *detection*, not brute-force prevention — every secret involved is already high-entropy and computationally infeasible to guess.

Both needs are the same underlying primitive: a fast, shared, TTL-expiring counter reachable by every API instance. ADR-002 already considered and rejected introducing Redis once, for a different problem (SRI sequential number generation) — that rejection was specific to sequential numbers, where Postgres's transactional `SELECT ... FOR UPDATE` is a strictly better fit (durability and uniqueness matter there; the counters here are disposable). Revisiting that decision for *this* problem: implementing a shared, hot-path, sub-request-latency counter on Postgres would mean either a table under heavy row-level lock contention (bad fit — rate limiting runs on literally every request) or hand-rolling TTL-based expiry that Postgres has no native primitive for. Redis is purpose-built for exactly this (`INCR`/`EXPIRE`, sub-millisecond, no schema migration for state that's meant to be thrown away).

## Decision

Introduce Redis into the stack, scoped narrowly: it only ever backs **ephemeral, short-TTL counters** — never durable business data, and never anything requiring transactional guarantees. This does not reopen ADR-002 — sequential number generation is unaffected and stays on Postgres `SELECT ... FOR UPDATE`.

- **`src/services/redis.service.js`** is the single shared client (a lazily-created `ioredis` singleton), reused by every consumer rather than each standing up its own connection.
- **Optional, not required.** `REDIS_URL` unset means `getClient()` returns `null` and every consumer degrades gracefully — rate limiting falls back to `express-rate-limit`'s in-memory store (correct for today's single-instance topology); the attempt tracker becomes a silent no-op. Redis is never a startup requirement (`src/config/validate.js`), matching the treatment already given to `SENTRY_DSN`.
- **Self-hosted as a container on the same droplet** (`deploy/docker-compose.yml`'s `redis` service), not a managed provider (e.g. Upstash). This is only correct because the near-term scaling plan is more `api` replicas on the *same* droplet before ever provisioning a second one — every replica shares the same Docker network and can reach `redis:6379`. If the API ever scales across multiple droplets, this choice needs revisiting (a droplet-local Redis stops being *shared* the moment a second droplet exists) — see "Alternatives Considered."
- **Two consumers ship together, sharing the one client:**
  - `src/middleware/rate-limit.js`'s `buildStore(prefix)` — a `RedisStore` (via `rate-limit-redis`) per limiter (`writeLimiter`/`readLimiter`/`adminLimiter`/`registrationLimiter`), each with its own key prefix. Every limiter also sets `passOnStoreError: true` so a Redis outage fails **open** (allows the request) rather than 500ing every rate-limited request.
  - `src/services/attempt-tracker.service.js`'s `recordEvent(eventType, key)` — `INCR` + `PEXPIRE` (only on the first hit, so it's a fixed window), returning whether the configured threshold was crossed. Wrapped in try/catch, always fails open on any Redis error. Wired into four call sites: `RECOVERY_SUCCESS` (`registration.service.js`'s `recover()`), `API_KEY_AUTH_FAILURE` (`authenticate.js`), `ADMIN_AUTH_FAILURE` (`authenticate-admin.js`), `MAILGUN_WEBHOOK_INVALID_SIGNATURE` (`verify-mailgun-webhook.js`). On the exact count that crosses the threshold, fires both a `console.warn` and `Sentry.captureMessage` (tagged by `eventType`) — Sentry is what actually makes a crossing visible today, since structured log aggregation (NEXT_STEPS.md item 4) doesn't exist yet. See `docs/guides/repeated-attempt-detection.md` for the alert-response runbook.

A related bug was found and fixed while wiring the attempt tracker's IP-keyed call sites: `rate-limit.js`'s existing IP-based limiters (`adminLimiter`, `registrationLimiter`, and `writeLimiter`/`readLimiter`'s unauthenticated fallback) called `ipKeyGenerator(req)` instead of `ipKeyGenerator(req.ip)` — passing the whole request object instead of an IP string, which silently collapsed every distinct IP onto the same counter. Not part of this decision, but directly adjacent (same helper, same subsystem) — see CLAUDE.md Common Mistake #44.

## Consequences

### Positive
- Rate limiting is now correct across multiple API instances — the exact bug this ADR exists to fix.
- A reusable, already-proven primitive exists for the next ephemeral-shared-counter need, rather than each future consumer inventing its own.
- Both consumers fail open by design — a Redis outage degrades rate limiting to single-instance behavior and fully disables attempt detection, but never breaks or slows the request path itself.
- Zero new operational burden today: no persistence (`--save ""`), no backup strategy, no monitoring beyond what already exists — losing all Redis state at any moment is a correctness no-op (counters just reset), never a data-loss event.

### Negative
- A new infrastructure dependency to run and reason about, even if a lightweight one.
- The self-hosted-on-one-droplet choice doesn't automatically generalize — it's only correct for the "more replicas on the same droplet" scaling stage, not a future multi-droplet one.

### Mitigation
- Scoped tightly to ephemeral, disposable data only — this is what keeps the operational burden near zero. Redis is never asked to hold anything that would be a problem to lose.
- `REDIS_URL` is optional everywhere it's consumed, with an explicit graceful-degradation path designed in from the start, not bolted on.

### Alternatives Considered
- **Postgres-backed counters** (a table + row-level or advisory locks): rejected — puts extremely hot-path, non-durable state through the same transactional machinery as real business data, adding write load and lock contention to Postgres for something that doesn't need durability at all. This is the same reasoning ADR-002 used in the other direction (Postgres over Redis) — here the shape of the problem (ephemeral, TTL-based, hot-path) favors Redis instead.
- **Accept the existing in-memory-only behavior**: rejected — this is the status quo bug being fixed. Would mean knowingly shipping something that's documented as incorrect the moment horizontal scaling is needed, rather than fixing it while the fix is cheap and low-risk (single instance today, so nothing observably changes).
- **Managed Redis (e.g. Upstash) instead of self-hosted**: considered and deferred, not rejected outright. Self-hosted-on-the-droplet is strictly correct and free for the scaling plan actually in view (more `api` replicas on the same droplet); a managed provider only becomes necessary once multiple droplets exist, since a droplet-local Redis isn't reachable from a second droplet. Revisit at that point — it's a `REDIS_URL`/hosting change only, not a code change, since every consumer already talks to Redis through one connection-string-configured client.
