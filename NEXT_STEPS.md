# Next Steps

Post-refactoring roadmap for the SRI Tax Core service. Each item is independent and can be delivered as its own PR. Items are ordered by value-to-effort ratio.

---

## ~~Authentication & Multi-Tenancy~~ ✅ Done (Phase 2)

Implemented in migration 023 and `src/middleware/authenticate.js`:
- Bearer API key → SHA-256 hash → `api_keys` JOIN `issuers` → `req.issuer`
- Full tenant isolation: all DB queries scoped by `issuer_id`
- Dev seeder creates a dev API key and prints the plaintext token to console
- See ADR-007 for the decision rationale

---

## ~~Idempotency Key~~ ✅ Done (Phase 0)

Implemented in migration 021 and `src/middleware/idempotency.js`. Same key + same body → `200` replay; same key + different body → `409`. Concurrent race handled via `23505` in the rollback path.

---

## ~~Email Delivery~~ ✅ Done

RIDE PDF + authorization XML sent fire-and-forget on `AUTHORIZED`. Per-document `email_status` tracking. Batch retry `POST /api/documents/email-retry`, single retry `POST /api/documents/:accessKey/email-retry`. Provider swappable via `EMAIL_PROVIDER` env var.

Remaining: issuer logo (`logo_path`) not yet rendered in emails (column exists in `issuers`).

---

## 1. Async Worker Foundation

**Why:** `POST /:key/send` and `GET /:key/authorize` are synchronous — the caller blocks waiting for SRI's SOAP response (5–30 s, unreliable). An async worker decouples the caller from SRI latency.

**What:**
- Add `PENDING_SEND` status: queued for transmission (between `SIGNED` and `RECEIVED`)
- `PROCESSING_MODE` env var: `sync` (current, default) | `async`
- In async mode: `POST /:key/send` → `PENDING_SEND` immediately, returns 202
- Worker: `SELECT ... FOR UPDATE SKIP LOCKED` on `PENDING_SEND` → submit to SRI → `RECEIVED|RETURNED`
- Worker also polls `RECEIVED` documents older than N minutes and checks authorization
- Update state machine constants + migration 027 trigger: add `SIGNED → PENDING_SEND` and `PENDING_SEND → RECEIVED|RETURNED`

**Files:** new `src/workers/transmission.worker.js`, new migration (alter trigger), update `document-state-machine.js`

---

## 2. Additional Document Types

**Why:** SRI compliance requires more than invoices. Credit notes and retention vouchers are the most commonly needed.

**Priority order:**
- `04` — Nota de crédito (credit note)
- `05` — Nota de débito (debit note)
- `07` — Comprobante de retención (retention voucher)
- `03` — Liquidación de compra
- `06` — Guía de remisión

**Per new type:**
1. New builder class in `src/builders/` extending `BaseDocumentBuilder`
2. One registry entry in `src/builders/index.js`
3. New XSD asset in `assets/` (download from SRI portal)
4. Update `xml-validator.service.js` to select schema by `documentType`
5. Add the type code to the `isIn([...])` validator in `invoice.validator.js`

Creation, transmission, rebuild, and query services need zero changes — the builder registry handles dispatch.

---

## 3. Admin API

**Why:** No HTTP interface exists to manage issuers or API keys — currently done via direct SQL or the dev seeder.

**What:**
- `POST /admin/issuers` — create issuer (RUC, cert upload, addresses, environment)
- `GET  /admin/issuers/:id` — read issuer
- `POST /admin/issuers/:id/api-keys` — generate API key (returns plaintext once)
- `DELETE /admin/api-keys/:id` — revoke a key
- Protected by a separate `ADMIN_SECRET` env var or a scoped API key (`api_keys.scopes` column)

**Files:** new `src/routes/admin.routes.js`, controller, service; extend `api-key.model.js`

---

## 4. Rate Limiting

**Why:** Without per-key limits, a compromised or misbehaving key could exhaust sequential numbers and SRI quota.

**What:**
- `express-rate-limit` keyed by `keyHash` (available on `req` after `authenticate`)
- Defaults: 60 req/min per key on write endpoints, 300/min on read endpoints
- `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` env vars
- 429 response with `Retry-After` header

**Files:** `npm install express-rate-limit`, new config, mount after `authenticate`

---

## 5. Webhook Notifications

**Why:** In async mode, callers cannot know when a document becomes `AUTHORIZED` or `RETURNED` without polling. Webhooks push status changes.

**What:**
- `webhook_url` column on `issuers`
- `src/services/webhook.service.js` — `POST webhook_url` with `{ accessKey, status, previousStatus, timestamp }` signed with `HMAC-SHA256(WEBHOOK_SECRET, body)`
- Called fire-and-forget after every `STATUS_CHANGED` event
- Exponential backoff retry on failure
- New `WEBHOOK_DELIVERED` / `WEBHOOK_FAILED` event types — update `chk_document_events_event_type` CHECK constraint

**Files:** new migration (column + constraint update), new webhook service, update transmission service

---

## 6. Document Archival

**Why:** 7-year SRI retention requirement. Active table will degrade without partitioning.

**What:**
- Partition `documents` by `issue_date` (range by year)
- Migration to convert to partitioned table + initial partitions
- Archival job: documents older than 7 years → S3 → delete from DB
- `GET /:key/xml` and `GET /:key/ride` fall back to S3 if not in DB

**Files:** new migrations, new archival worker, update query service

---

## Other Items (lower priority)

- **OpenAPI / Swagger** — `openapi.yaml` spec + Swagger UI at `/docs`
- **Docker / Containers** — `Dockerfile` + `docker-compose.yml` + `GET /health` endpoint
- **Reporting** — revenue summaries, document counts by status/date, CSV export
- **Issuer logo in emails** — `logo_path` column exists in `issuers`, not yet rendered in RIDE email
