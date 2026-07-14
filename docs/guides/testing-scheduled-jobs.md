# Testing Scheduled Jobs Locally

The four admin-triggered jobs are date-driven — each one scans for rows whose timestamp has already passed. Since nothing is truly "scheduled" inside the app itself (an external cron calls these endpoints), the fastest way to exercise any of them locally is to push the relevant timestamp into the past with a direct SQL update, then call the endpoint.

| Job | Endpoint | Cadence | What it scans for |
|---|---|---|---|
| Notifications | `POST /v1/admin/jobs/notifications` | every 5 min | `issuers.cert_expiry`, `webhook_deliveries.next_retry_at` |
| Subscriptions | `POST /v1/admin/jobs/subscriptions` | daily | `subscriptions.current_period_end`, `pending_tier` |
| Quota | `POST /v1/admin/jobs/quota` | daily | `tenant_quotas.period_end` |
| Queue reconciliation | `POST /v1/admin/jobs/queue-reconciliation` | every 1-5 min | `documents.send_dispatch_attempted_at`/`authorize_dispatch_attempted_at` (both `public` and `sandbox` schemas) |

All four are **idempotent** — re-running them when nothing is due is always safe and a no-op. Unlike the other three, the queue reconciliation job requires an actual RabbitMQ connection (`RABBITMQ_URL`) to do anything useful — it publishes real messages, it doesn't just read/write Postgres.

## Prerequisites

- A running local server with a test DB migrated (`npm run migrate`).
- `ADMIN_SECRET` from your `.env`.
- At least one tenant with an issuer (see `postman/TESTING.md` for the full registration walkthrough) — every tenant already gets a `tenant_quotas` row automatically on creation.
- For subscription tests, an `ACTIVE` subscription — either created through the real proof/review/link-invoice flow, or inserted directly for speed:
  ```sql
  INSERT INTO subscriptions (tenant_id, tier, billing_interval, status, current_period_start, current_period_end)
  VALUES (<TENANT_ID>, 'GROWTH', 'MONTHLY', 'ACTIVE', NOW() - INTERVAL '1 month', NOW() + INTERVAL '10 days')
  RETURNING id;
  ```

## Triggering a job

```bash
curl -X POST http://localhost:8080/v1/admin/jobs/notifications        -H "X-Admin-Secret: <ADMIN_SECRET>"
curl -X POST http://localhost:8080/v1/admin/jobs/subscriptions         -H "X-Admin-Secret: <ADMIN_SECRET>"
curl -X POST http://localhost:8080/v1/admin/jobs/quota                 -H "X-Admin-Secret: <ADMIN_SECRET>"
curl -X POST http://localhost:8080/v1/admin/jobs/queue-reconciliation  -H "X-Admin-Secret: <ADMIN_SECRET>"
```
Or use "Run Notification Jobs" / "Run Subscription Jobs" / "Run Quota Jobs" / "Run Queue Reconciliation Jobs" in `postman/comprobify-internal.postman_collection.json`.

---

## 1. Notifications job

### 1a. Certificate expiry alerts

`runCertChecksForTenant()` classifies by `cert_expiry` relative to now (`CERT_WARN_DAYS = 30`, `CERT_ERROR_DAYS = 7`):

| `cert_expiry` set to | Result |
|---|---|
| `NOW() + INTERVAL '60 days'` | No alert (or clears an existing one — "auto-dismiss") |
| `NOW() + INTERVAL '20 days'` | `CERT_EXPIRING`, severity `WARNING` |
| `NOW() + INTERVAL '5 days'` | `CERT_EXPIRING`, severity `ERROR` (within `CERT_ERROR_DAYS`) |
| `NOW() - INTERVAL '1 day'` | `CERT_EXPIRED`, severity `ERROR` |

```sql
UPDATE issuers SET cert_expiry = NOW() + INTERVAL '5 days' WHERE id = <ISSUER_ID>;
```
Run the notifications job, then check:
```sql
SELECT type, severity, title FROM notifications
WHERE tenant_id = <TENANT_ID> ORDER BY created_at DESC LIMIT 1;
```
To test auto-dismiss: set `cert_expiry` back to `NOW() + INTERVAL '60 days'` and run the job again — the existing alert should flip to read (`markAllCertAlertsAsRead`).

### 1b. Webhook retry queue

Retries only pick up rows where `webhook_deliveries.status = 'RETRYING' AND next_retry_at <= NOW()`. The simplest way to get a real `RETRYING` row is to register a webhook pointing at an address nothing listens on, then let a real notification fan out and fail naturally:

1. Register a webhook via `POST /v1/webhooks` with `url: "http://127.0.0.1:1"` (an unreachable port) and subscribe it to `CERT_EXPIRING` or whatever type you're about to trigger.
2. Trigger a notification (e.g. redo the cert-expiry test above) — `webhookDeliveryService.fanOut()` will attempt delivery, fail, and create a `webhook_deliveries` row with `status = 'RETRYING'`, `attempt_count = 1`, `next_retry_at = NOW() + 30s` (`RETRY_DELAYS_SECONDS = [30, 120]`).
3. Don't wait 30 seconds — fast-forward it:
   ```sql
   UPDATE webhook_deliveries SET next_retry_at = NOW() - INTERVAL '1 minute'
   WHERE id = <DELIVERY_ID>;
   ```
4. Run the notifications job. Since the URL is still unreachable, the retry fails again: `attempt_count` → 2, `next_retry_at` pushed out by 120s (index 1 of `RETRY_DELAYS_SECONDS`).
5. Repeat step 3 once more and re-run the job — this is the last retry (index 2 is `undefined`), so it should exhaust to `status = 'FAILED'` permanently instead of scheduling another retry.

```sql
SELECT status, attempt_count, next_retry_at, last_response FROM webhook_deliveries WHERE id = <DELIVERY_ID>;
```

---

## 2. Subscriptions job

Runs `applyScheduledTierChanges()` then `processDueRenewals()`, in that order (order matters — a downgrade must roll its period forward before the expiry check runs, or it would look freshly expired).

### 2a. Scheduled downgrade
```sql
UPDATE subscriptions
SET pending_tier = 'STARTER', current_period_end = NOW() - INTERVAL '1 day'
WHERE id = <SUB_ID> AND status = 'ACTIVE';
```
After running: `tier` flips to `STARTER`, `pending_tier` clears, `current_period_start`/`end` roll forward one interval **from the old `current_period_end`** (never "now"), and the tenant's `tenant_quotas` cap drops to STARTER's immediately (`tenantQuotaService.setCap`).

### 2b. Renewal reminder (7-day window)
```sql
UPDATE subscriptions
SET pending_tier = NULL, current_period_end = NOW() + INTERVAL '2 days'
WHERE id = <SUB_ID> AND status = 'ACTIVE';
```
Won't re-fire if a `RENEWAL` payment is already open for this subscription (`period_start IS NULL`) — clear one first if re-testing:
```sql
DELETE FROM payments WHERE subscription_id = <SUB_ID> AND purpose = 'RENEWAL' AND period_start IS NULL;
```
After running: a new `payments` row (`purpose = 'RENEWAL'`) appears, plus a `RENEWAL_DUE` tenant event.

### 2c. Expiry — non-payment (not suspension!)
```sql
UPDATE subscriptions
SET current_period_end = NOW() - INTERVAL '8 days'  -- past the 7-day grace
WHERE id = <SUB_ID> AND status = 'ACTIVE';
```
After running:
```sql
SELECT status FROM subscriptions WHERE id = <SUB_ID>;                  -- EXPIRED
SELECT status, subscription_tier FROM tenants WHERE id = <TENANT_ID>;  -- status still ACTIVE, tier FREE
SELECT document_quota FROM tenant_quotas WHERE tenant_id = <TENANT_ID> AND is_current = true; -- already FREE's cap
```
**Important:** `tenants.status` never changes here. A lapsed subscription only downgrades the tier automatically (`expireSubscription()` → `setCap`) — it does **not** set `SUSPENDED`. `SUSPENDED` is a separate, admin-only lever (`PATCH /v1/admin/tenants/:id/status`) unrelated to billing. A tenant whose subscription expired can call `POST /v1/subscriptions` again immediately with no admin involvement — `findActiveOrPendingByTenantId` only blocks a new subscription while an existing one is still in a non-terminal status, and `EXPIRED`/`CANCELLED` don't count.

### 2d. Yearly plan — confirm it's unaffected mid-year
```sql
UPDATE subscriptions
SET billing_interval = 'YEARLY',
    current_period_start = NOW() - INTERVAL '6 months',
    current_period_end   = NOW() + INTERVAL '6 months'
WHERE id = <SUB_ID> AND status = 'ACTIVE';
```
Run the subscriptions job — nothing should change on this subscription (well outside both the 7-day reminder and grace windows). This is the counterpart to the quota job scenario below: billing and quota run on genuinely independent clocks.

---

## 3. Quota job

### 3a. Basic rollover
```sql
UPDATE tenant_quotas SET period_end = NOW() - INTERVAL '1 day'
WHERE tenant_id = <TENANT_ID> AND is_current = true;
```
After running:
```sql
SELECT tenant_id, period_start, period_end, document_quota, document_count, is_current
FROM tenant_quotas WHERE tenant_id = <TENANT_ID> ORDER BY period_start DESC;
```
Expect: the old row is now `is_current = false`; a new row exists with `document_count = 0`, `period_start` equal to the *old* `period_end` (anchored, not "now"), and `document_quota` matching the tenant's current `subscription_tier`.

### 3b. Independent of billing_interval
Run this regardless of whether the tenant's subscription is `MONTHLY` or `YEARLY` (see scenario 2d) — the quota job doesn't look at `subscriptions` at all. This is the core guarantee: a YEARLY subscriber still gets their document quota refreshed every month, not once a year.

### 3c. Cap updates don't wait for this job
Any tier change (upgrade, downgrade, expiry-to-FREE, admin override via `PATCH /v1/admin/tenants/:id/tier`) calls `tenantQuotaService.setCap()` synchronously as part of that action — the current period's `document_quota` updates immediately, without needing the quota job to run at all. The quota job only ever handles the *period boundary* (rolling `document_count` back to 0 on a new cycle), never the cap value by itself.

---

## 4. Queue reconciliation job

Requires a real RabbitMQ connection (`RABBITMQ_URL` in `.env`) — this job publishes actual messages, so watch the queue depth/message count in your broker's management UI (e.g. CloudAMQP) to confirm a re-publish happened, alongside the SQL checks below.

### 4a. Stuck `PENDING_SEND` (never dispatched, or broker was down)
```sql
-- Simulate a document that was queued but never confirmed-dispatched — e.g. RabbitMQ
-- was unreachable when POST /:key/send tried to publish.
UPDATE documents SET status = 'PENDING_SEND', send_dispatch_attempted_at = NULL
WHERE id = <DOCUMENT_ID>;
```
Run the reconciliation job — expect `sendRepublished` to include this document, and `send_dispatch_attempted_at` to be set afterward:
```sql
SELECT status, send_dispatch_attempted_at FROM documents WHERE id = <DOCUMENT_ID>;
```
With `workers/sri-worker.js` running (`npm run worker`), the document should shortly move to `RECEIVED`/`RETURNED` on its own — the reconciliation job itself never touches SRI.

### 4b. Stale dispatch (published once, but nothing ever consumed it)
```sql
UPDATE documents SET status = 'PENDING_SEND', send_dispatch_attempted_at = NOW() - INTERVAL '10 minutes'
WHERE id = <DOCUMENT_ID>;
```
With the default `QUEUE_RECONCILE_SEND_STALE_MINUTES=5`, this is already past the staleness threshold — the job re-publishes it the same as 4a.

### 4c. `RECEIVED` document awaiting its first authorize-check
```sql
UPDATE documents SET status = 'RECEIVED', updated_at = NOW() - INTERVAL '10 minutes', authorize_dispatch_attempted_at = NULL
WHERE id = <DOCUMENT_ID>;
```
Run the job — expect `authorizeRepublished` to include this document. This is the mechanism that replaces "poll `RECEIVED` documents older than N minutes" from the original design — the job publishes the check request, the worker's `checkAuthorization()` call does the actual SRI query.

### 4d. Nothing due — confirm it's a no-op
Run the job again immediately after 4a-4c with no further SQL changes — expect `sendRepublished: 0, authorizeRepublished: 0` (both dispatch timestamps are now fresh).

---

## 5. Combined scenario: cancel a monthly plan, restart it next "month"

1. Run **2c** above to simulate the lapse — tier drops to FREE, tenant stays `ACTIVE`.
2. Confirm quota records keep being created regardless — run **3a** any time during the gap; the rollover happens on schedule with whatever cap currently applies (FREE, in this case), completely unaware a subscription ever existed.
3. To "start again": call `POST /v1/subscriptions` for the same tenant (succeeds — the old subscription is terminal). Walk it through proof upload → admin review (`VERIFIED`) → self-billed invoice → `PATCH /v1/admin/subscriptions/:id/link-invoice`. If the linked document is already `AUTHORIZED`, activation applies immediately — no need to wait for a webhook.
4. Check `tenant_quotas` again — the cap already reflects the new paid tier, same day, independent of whether the quota job has run since.

This is the same asymmetry noted in CLAUDE.md's quota section: billing periods get an explicit "restart the clock now" moment at (re)activation, but quota periods just keep ticking on their own schedule since the tenant was created — harmless here since nothing was consumed during the gap, but worth knowing if you're checking exact period boundaries in a test.
