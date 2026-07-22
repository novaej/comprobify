# ADR-019: RabbitMQ-Backed Async SRI Submission

## Status
Accepted

## Date
2026-07-13

## Context

`POST /:key/send` and `GET /:key/authorize` called SRI's SOAP services synchronously, inline in the HTTP request. SRI's response time is typically 5–30 seconds and can time out, so both endpoints caused long-hanging requests and poor client experience under load.

Separately, the codebase already had a growing list of fire-and-forget side effects (invoice email, notification creation, webhook fan-out, subscription activation hooks) implemented as unawaited promises with only a `.catch(console.warn)` — if the process crashed mid-flight, or the call threw, that work was silently lost with no retry. Both problems share the same root cause: no durable queue between "a request happened" and "the resulting work is guaranteed to complete."

The obvious fix — a message broker — introduces a new failure mode of its own: what happens when the broker itself is unavailable? A naive integration (publish, and treat a failed/unconfirmed publish as equivalent to the request failing) would just move the reliability problem from "SRI is slow" to "RabbitMQ is down," without net improvement for a system whose whole point is production reliability for a legally-consequential invoicing pipeline.

## Decision

**Postgres is the only source of truth. RabbitMQ is purely a confirmed-dispatch signal, never the record.**

- A new `PENDING_SEND` document status sits between `SIGNED` and `RECEIVED`/`RETURNED`. `POST /:key/send` moves a document to `PENDING_SEND` **durably in Postgres, before any publish attempt** — this state change happens regardless of whether RabbitMQ is reachable.
- A publisher (`src/services/queue.service.js`, `amqplib`) then attempts a **broker-confirmed** publish (a confirm channel, not just "the call didn't throw") and only stamps a dispatch-tracking timestamp (`send_dispatch_attempted_at`/`authorize_dispatch_attempted_at`) on confirmation. If the publish fails or times out (3s), the request still succeeds — the document is already `PENDING_SEND`, and nothing about that fact depends on the broker.
- Consumers (`workers/sri-worker.js`, a standalone long-running process — the only code that calls SRI) are the only place real work happens. No duplicate SRI-calling logic exists anywhere else, so there's nothing to drift out of sync.
- `POST /v1/admin/jobs/queue-reconciliation` finds documents whose dispatch was never confirmed or has gone stale and **re-publishes a fresh message for them — it never calls SRI itself.** This is the one rule that makes the whole design work: if the reconciliation job also called SRI directly as a fallback, that would be a second implementation of "submit to SRI," and the two would inevitably diverge over time (a bug fix applied to one path and not the other). Keeping "call SRI" as a single responsibility means a RabbitMQ outage degrades to reconciliation-interval latency (currently hourly — see `render.yaml`), never lost work or failed requests.
- Consumers must be idempotent: a state-machine violation on redelivery (another delivery already processed the document — possible under RabbitMQ's at-least-once semantics, e.g. a false-negative publisher confirm followed by a reconciliation re-publish) is treated as benign and acknowledged, not retried. A genuine failure is `nack`'d with `requeue: false` — RabbitMQ itself never retries a message; only the Postgres-driven reconciliation job does, and only after re-checking current state.
- No sync fallback. The original design draft proposed a `PROCESSING_MODE=sync|async` toggle as a rollback safety valve; this was dropped in favor of the codebase's existing "don't use feature flags when you can just change the code" convention (CLAUDE.md) — a permanent dual code path (two implementations of send/authorize, forever) was judged worse than accepting that rollback, if ever needed, is a redeploy rather than an env var flip.
- Deployed as a single shared RabbitMQ instance (CloudAMQP, matched to the same AWS region as the Render web service) rather than one broker per system, isolated by vhost/credentials — consistent with how a message broker is normally shared across an organization's systems rather than provisioned per-app.

Migration `074_pending_send_status.sql` had to update **two independent places** that both encode the transition graph: the JS state machine (`src/constants/document-state-machine.js`) and the PostgreSQL trigger function `enforce_document_state_transition()` (ADR-008, migration 027) — the DB trigger hardcodes the same graph on its own and is not derived from the JS constants, so updating only one would have passed application-level validation while Postgres rejected the write. See CLAUDE.md Common Mistake #39.

Phase 2 (migrating the existing fire-and-forget side effects listed above onto this same publish/confirm/reconcile mechanism) is deliberately out of scope for this ADR — see ADR-022, which also generalizes this ADR's own dispatch-tracking columns (`send_dispatch_attempted_at`/`authorize_dispatch_attempted_at`) onto the same generic `pending_effects` mechanism it introduces for everything else.

## Consequences

### Positive
- `POST /:key/send`/`GET /:key/authorize` no longer hang on SRI's response time; both return in the time it takes to write to Postgres and attempt a publish.
- A RabbitMQ outage — total or partial — never fails a request and never loses a queued document; it only adds latency, bounded by the reconciliation job's cadence.
- Exactly one implementation of "call SRI" exists in the system, eliminating the drift risk of a DB-polling fallback duplicating the worker's logic.
- The design generalizes directly to Phase 2's fire-and-forget side effects without inventing a new pattern.

### Negative
- `POST /:key/send`/`GET /:key/authorize` no longer return the final SRI result synchronously — any existing integration reading `sriStatus`/final `status` directly from these responses breaks and must instead poll `GET /:accessKey` or rely on the notification/webhook system.
- A new operational dependency (RabbitMQ) and a new deployable process (`workers/sri-worker.js`, a persistent Background Worker rather than a request-driven web service) that need to be provisioned, monitored, and deployed independently of the API.
- Two places now encode the document status graph (JS + DB trigger) that must be kept in sync by hand — an existing cost from ADR-008, made concrete again by this change.

### Mitigation
The negative response-shape change is deliberate and documented (CHANGELOG, endpoint docs) rather than papered over with a compatibility shim. The new operational dependency is scoped tightly — RabbitMQ is only in the critical path for the send/authorize pipeline, not the rest of the API, and the reconciliation job means its unavailability degrades gracefully rather than causing outright failures.

### Alternatives Considered
- **`PROCESSING_MODE=sync|async` toggle, both paths maintained indefinitely**: the original draft design. Rejected — a permanent dual implementation to test and maintain forever, against this codebase's own stated preference for changing the code outright over feature-flagging it.
- **RabbitMQ (or the DB poller) as the actual retry/processing mechanism**, i.e. the reconciliation job calling SRI directly for stuck documents: rejected because it duplicates the worker's business logic in a second place, with the two implementations free to drift apart over time. Reconciliation "only makes sure a message exists" instead.
- **`pg-boss` or a similar Postgres-native job queue** instead of a real broker: considered during initial design discussion. A real broker (RabbitMQ) was preferred for its more mature tooling/observability (management UI, per-vhost isolation for future multi-system sharing) despite requiring new infrastructure, given the project's stated priority is production reliability for this specific pipeline. Not ruled out for other future queueing needs.
- **LavinMQ** (CloudAMQP's own AMQP-0.9.1-compatible broker, offered at a discount on free-tier limits): considered and rejected in favor of RabbitMQ itself — RabbitMQ has a much longer production track record and is available natively on far more hosting platforms if this project ever needs to leave CloudAMQP, which matters more here than the free-tier headroom given the reliability goal driving this whole change. The protocol compatibility between the two means switching later, if ever warranted, would not require client-code changes.
- **Self-hosting RabbitMQ on Render** (a Private Service running the official Docker image) instead of a managed provider: considered as the deployment target and not ruled out long-term, but a managed CloudAMQP instance was chosen first to avoid owning durability/restart/backup behavior for a piece of infrastructure this project has no prior operational experience running.
