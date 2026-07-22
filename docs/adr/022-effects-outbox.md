# ADR-022: pending_effects — a Generic Outbox for All Async Side Effects

## Status
Accepted

## Date
2026-07-22

## Context

ADR-019 (Phase 1) made `POST /:key/send`/`GET /:key/authorize` durable by writing state to Postgres before attempting a RabbitMQ publish, with dispatch tracked via two columns directly on `documents` (`send_dispatch_attempted_at`/`authorize_dispatch_attempted_at`) and two hand-written reconciliation queries. ADR-019 explicitly scoped a Phase 2 as a deliberate follow-up: ~15 other side effects — notification creation, webhook fan-out, subscription activation hooks, transactional emails — were still unawaited promises with only `.catch(console.warn)`. If the process crashed between the triggering write and that promise resolving, the work was silently lost with no record it was ever supposed to happen.

This ADR covers that Phase 2, plus one additional decision made during implementation: rather than leaving Phase 1's per-document columns in place and adding a second, parallel mechanism for the other 15 effects, this migrates SRI send/authorize dispatch tracking onto the same generic mechanism too. The two problems — "did we definitely tell RabbitMQ about this" — are identical in shape regardless of what "this" is; maintaining two implementations of the same idea was judged worse than one migration touching already-shipped code.

## Decision

**One generic outbox table, `pending_effects` (migration 075), replaces both the Phase-1 columns and the ad hoc fire-and-forget promises.** Every producer call site follows the same two-step shape:

```js
const effect = await pendingEffectService.enqueue(EffectTypes.X, payload);
pendingEffectService.dispatch(effect);
```

`enqueue()` is a durable, awaited insert — the effect intent survives a crash even if `dispatch()` never runs. `dispatch()` attempts a broker-confirmed publish and is best-effort, mirroring Phase 1's `queueSend` exactly: a failed/timed-out publish never fails the caller's request, and the row is picked up later by reconciliation.

### Schema

`effect_type` (17 values, CHECK-constrained), `payload` (JSONB — ids only, never full row snapshots, so handlers always read fresh state), `dedup_key` (nullable — see below), `status` (`PENDING → DISPATCHED → DONE`, or `→ FAILED` past `maxAttempts`), `dispatch_attempted_at`, `attempt_count`, `last_error`. Not tenant/issuer-scoped, no RLS — same precedent as `notifications`/`tenant_events`/`webhook_deliveries`. Never hard-deleted (CLAUDE.md rule #7).

### Registry, not bespoke columns per table

`src/effects/index.js` maps each `effect_type` to a handler function, mirroring `src/builders/index.js`'s existing "registry keyed by a type string" idiom for document types. This was chosen over the alternative of giving `documents`, `tenants`, `payments`, and `subscriptions` each their own bespoke dispatch-tracking columns (which is what Phase 1 did for `documents` alone) — one small reusable mechanism plus 17 thin handler functions is less code and less drift risk than five different ad hoc per-table implementations of the same "make sure this happens" idea.

### Two behavioral buckets, one table

16 of the 17 types are **one-shot**: run once, succeed, done. `SRI_AUTHORIZE` is the exception — SRI's authorization can take real time, and "still processing" is neither success nor failure. Rather than a second table or a different status vocabulary, a handler can resolve with `{ requeue: true }`; the processor leaves the row exactly as-is (not `DONE`, `attempt_count` untouched) and reconciliation's normal staleness window picks it up again later. This keeps the claim/retry/reconcile logic identical for all 17 types — only `SRI_AUTHORIZE`'s handler ever uses the escape hatch.

`sendToSri` (the `SRI_SEND` handler) durably enqueues the `SRI_AUTHORIZE` row itself, the instant a document becomes `RECEIVED` — but does not dispatch it. This guarantees every `RECEIVED` document eventually gets an authorize-check even if the client never calls `GET /:key/authorize`; the first-attempt delay is naturally provided by reconciliation's `authorizeCheckDelayMinutes` window. `queueAuthorizationCheck` (the HTTP-facing side) finds-or-creates that same row via `dedup_key = 'sri-authorize:'+documentId` and dispatches it immediately, since a client's explicit request shouldn't wait through the delay. `dedup_key` is the one piece of extra machinery `SRI_AUTHORIZE` needs that no other type does — a document's own state machine already prevents duplicate `SRI_SEND` rows, and the other 15 types are each created from a single call site per real-world event.

### Idempotency under at-least-once redelivery

`pendingEffectService.process(effectId)` claims the row with `SELECT ... FOR UPDATE` before running its handler. A duplicate delivery of the same message (RabbitMQ's at-least-once guarantee, or a reconciliation re-publish racing a delivery already in flight) blocks on that lock until the first attempt's transaction resolves, then sees the row already `DONE`/`FAILED` and no-ops. This is a real Postgres row lock, not in-process state, so the design stays correct even if the worker is ever scaled to more than one instance — no additional code required.

A handler throwing a `400 AppError` (a state-machine violation — another delivery already advanced the underlying document) is treated as benign and marked `DONE`, same reasoning Phase 1's `isBenignStateError` already used. Any other thrown error increments `attempt_count` and is rethrown so the worker `nack`s the message; RabbitMQ itself never retries — only reconciliation does, and only after re-checking current state.

One handler, `WEBHOOK_FANOUT`, needed an additional guard beyond the row-level lock: `webhookDeliveryService.fanOut()` creates a fresh `webhook_deliveries` row per endpoint on every call, so a worker crash between `fanOut()` sending and the effect being marked `DONE` could otherwise cause a retry to double-fan-out to endpoints that already received it. `fanOut()` now checks `webhookDeliveryModel.findByNotificationId()` first and skips any endpoint that already has a delivery row for that notification.

### Three RabbitMQ queues, not one

The first design draft routed all 17 effect types through a single new `app.effects` queue. This was rejected during review: `channel.prefetch(n)` in RabbitMQ is per-*consumer*, not per-channel, despite being set on the channel object — so a single shared queue means a single shared prefetch window. A burst of slow `WEBHOOK_FANOUT` deliveries (10s HTTP timeout each, hitting a sluggish third-party endpoint) could fill that window and delay `SRI_SEND`/`SRI_AUTHORIZE` message delivery — stalling the highest-stakes, legally-consequential part of the pipeline behind webhook or email latency.

The shipped design keeps `sri.send` and `sri.authorize` exactly as Phase 1 defined them — unchanged names, unchanged topology — and adds one new `app.effects` queue for the other 15 types. `src/constants/effect-types.js`'s `routingKeyForEffectType()` does the routing. `workers/worker.js` registers three independent `channel.consume()` calls on the same shared confirm channel; each gets its own prefetch window, so a burst on one queue can never starve another. All three consumers still call the identical `pendingEffectService.process(effectId)` — the queue split is purely a transport-layer isolation concern, the claim/retry/reconcile logic doesn't know or care which queue delivered a message.

### One worker process, not two

`workers/sri-worker.js` is renamed to `workers/worker.js` (its role broadened past SRI-only) rather than adding a second Render Background Worker service dedicated to side effects. Considered and rejected: full process isolation would prevent a bug in effect processing from ever affecting SRI submission, at the cost of a second service to provision, deploy, and monitor, and a second CloudAMQP connection. Given the per-consumer prefetch isolation above already prevents the concrete failure mode (queue starvation) without needing separate processes, and the row-level lock in `process()` makes the mechanism safe to parallelize later without further changes, splitting into a second worker later — if effects volume or CPU contention (e.g. `INVOICE_AUTHORIZED_EMAIL`'s RIDE PDF generation, real CPU work) ever justifies it — is a non-breaking follow-up: move `registerConsumers`'s `app.effects` registration to its own file, no protocol or schema changes needed.

Renaming the file also means renaming the Render service (`comprobify-staging-sri-worker` → `comprobify-staging-worker`) — Render treats a changed Blueprint `name:` as a new service rather than an in-place rename, so this requires a manual re-adoption step in the dashboard after merging, the same recovery dance `NEXT_STEPS.md` already documents for the original 3 cron jobs.

### Reconciliation collapses to one sweep

`queue-reconciliation.service.js` previously ran two functions (`reconcileSends`/`reconcileAuthorizations`), each executed twice (once per schema, `public.documents`/`sandbox.documents`) — up to 4 query executions per run. Since `pending_effects` isn't schema-scoped, this collapses to one `SELECT ... FOR UPDATE SKIP LOCKED` sweep, with a `CASE`-equivalent `WHERE` clause distinguishing `SRI_AUTHORIZE`'s two-threshold timing (delay-before-first-attempt, then stale-window for retries) from every other type's single stale-window check.

## Consequences

### Positive
- One reusable mechanism instead of five bespoke ones — adding an 18th effect type in the future is one constant, one handler function, and one call-site edit, not a new migration plus a new reconciliation query.
- SRI submission's reliability guarantees now extend uniformly to every other async side effect in the system — a crash between "decided this should happen" and "it happened" no longer loses work anywhere in the codebase, not just on the send/authorize path.
- Reconciliation code shrinks from 2 functions × 2 schemas to 1 function, 1 query.
- The row-lock-based idempotency mechanism generalizes to multi-instance worker scaling with zero additional code, should that ever be needed.

### Negative
- Migration 075 drops two columns from an already-shipped, already-verified production table (`documents.send_dispatch_attempted_at`/`authorize_dispatch_attempted_at`, both schemas) — a bigger blast radius than a purely additive Phase 2 would have had. Mitigated by the columns having no other consumers (confirmed via search before dropping) and by full end-to-end test coverage of the new path before merging.
- `pending_effects.payload` being JSONB with no foreign keys means referential integrity to `documents`/`tenants`/`payments`/etc. is not enforced at the DB level — a handler could theoretically be asked to process an effect referencing a row that no longer exists. Accepted: handlers already re-fetch and none of the referenced entities are ever hard-deleted (CLAUDE.md rule #7), so this is a null-check away from being a non-issue, not a real gap.
- One more file (`src/effects/index.js`) that must be kept in sync with `src/constants/effect-types.js`'s CHECK constraint whenever a new type is added — the same category of two-places-encode-the-same-thing cost ADR-019 already accepted for the JS state machine vs. the DB trigger.

### Alternatives Considered
- **Route all 17 types through one queue**: simpler topology, rejected once the per-consumer-prefetch starvation risk was identified — see above.
- **Two Render worker services** (SRI-only + effects-only): true process isolation, rejected for now as unnecessary given prefetch isolation already solves the concrete problem; left as a documented non-breaking follow-up if volume ever demands it.
- **Bespoke dispatch-tracking columns per table** (mirroring what Phase 1 did for `documents`): rejected — five different implementations of "make sure this got published" is exactly the kind of drift risk a shared mechanism avoids, and the marginal cost of the generic table over a bespoke column is negligible.
- **Keep Phase 1's columns and add pending_effects only for the 15 new types**: purely additive, lower migration risk, but leaves two parallel implementations of the identical idea (dispatch-tracking) permanently coexisting. Rejected in favor of full unification once the generalization was already being built.
