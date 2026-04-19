# Next Steps

Remaining work ordered by value-to-effort ratio. Each item is independent and can be delivered as its own PR.

See [STRATEGY.md](STRATEGY.md) for product context, pricing model, and phased roadmap.

---

## 1. Rate Limiting

**Priority: High — do before exposing to additional clients**

Without per-key rate limits a compromised or misbehaving API key can exhaust sequential numbers and SRI quota for all tenants.

**What:**
- `express-rate-limit` keyed by `keyHash` (available on `req` after `authenticate`)
- Defaults: 60 req/min per key on write endpoints, 300/min on read endpoints
- `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` env vars
- 429 response already handled — `TOO_MANY_REQUESTS` code is already in the `AppError` status map

**Effort:** Low — one middleware file and two config entries.

---

## 2. Additional Document Types

**Priority: High — required for full SRI compliance**

Only facturas (`01`) are currently supported. The builder registry pattern already makes adding new types straightforward.

**Priority order:**
- `04` — Nota de crédito (credit note)
- `07` — Comprobante de retención (retention voucher)
- `05` — Nota de débito (debit note)
- `03` — Liquidación de compra
- `06` — Guía de remisión

**Per new type:**
1. New builder class in `src/builders/` extending `BaseDocumentBuilder`
2. One registry entry in `src/builders/index.js`
3. New XSD asset in `assets/` (download from SRI portal)
4. Update `xml-validator.service.js` to select schema by `documentType`
5. Add the type code to the `isIn([...])` validator in `invoice.validator.js`

Creation, transmission, rebuild, and query services need zero changes.

---

## 3. Health Endpoint

**Priority: High — required for any production deployment**

No `/health` endpoint exists. Needed for load balancers, uptime monitors, and container orchestration liveness checks.

**What:**
- `GET /health` — checks DB connectivity, returns `{ status: "ok", uptime }` or `503`
- No authentication required
- Add to `src/routes/index.js` outside the authenticated router

**Effort:** Very low — one route, one DB ping query.

---

## 4. PostgreSQL Row-Level Security (RLS)

**Priority: High — implement before onboarding paying clients**

Current tenant isolation is enforced only at the application layer (`issuer_id` filter in
every query). A bug that omits a filter could expose another tenant's data. RLS adds a
second, independent enforcement layer at the database level.

**What:**
- Enable RLS on all tenant-scoped tables (`documents`, `document_line_items`,
  `document_events`, `sequentials`, `api_keys`)
- Create a policy per table: `USING (issuer_id = current_setting('app.current_issuer_id')::bigint)`
- Set `app.current_issuer_id` at the start of each request (e.g., in a `db.js` wrapper
  or via a transaction-scoped `SET LOCAL`)
- Superuser/admin connections bypass RLS by default — ensure the app connects as a
  non-superuser role

**Why it matters:** even a SQL bug that forgets `WHERE issuer_id = $1` cannot return
another tenant's rows. The database enforces the policy independently of application code.

**Effort:** Medium — migration to enable RLS + policy definitions + connection/query layer change.

---

## 5. Outbound Webhook Notifications

**Priority: Medium — important for client integrations**

Client systems currently have to poll `GET /:key/authorize` to know when a document becomes `AUTHORIZED` or `RETURNED`. Webhooks push status changes instead.

**What:**
- `webhook_url` column on `issuers` (set via admin API)
- `src/services/webhook.service.js` — `POST webhook_url` with `{ accessKey, status, previousStatus, timestamp }` signed with `HMAC-SHA256(WEBHOOK_SECRET, body)`
- Called fire-and-forget after every `STATUS_CHANGED` event
- Retry on failure (3 attempts, exponential backoff)
- `WEBHOOK_DELIVERED` / `WEBHOOK_FAILED` event types — requires updating the `chk_document_events_event_type` CHECK constraint

**Effort:** Medium — new migration, new service, update transmission service.

---

## 6. Async Worker for SRI Submission

**Priority: Medium — important for production reliability**

`POST /:key/send` and `GET /:key/authorize` block the HTTP request while waiting for SRI's SOAP response (typically 5–30 s, can time out). This causes long-hanging requests and poor client experience under load.

**What:**
- `PROCESSING_MODE` env var: `sync` (current default) | `async`
- New `PENDING_SEND` status: document queued for transmission
- In async mode: `POST /:key/send` → sets `PENDING_SEND`, returns 202 immediately
- Worker polls `PENDING_SEND` documents with `SELECT ... FOR UPDATE SKIP LOCKED` → submits to SRI → updates status
- Worker also polls `RECEIVED` documents older than N minutes to check authorization
- State machine and DB trigger must be updated to allow `SIGNED → PENDING_SEND`

**Effort:** High — new worker process, new status, migration, state machine update. Pairs well with outbound webhooks (item 5) to notify clients of async results.

---

## 7. Issuer Logo in Emails

**Priority: Low — cosmetic improvement**

The `logo_path` column exists on `issuers` but is not rendered in the authorization email or the RIDE PDF.

**What:**
- Read `issuer.logo_path` in `src/services/email/templates/invoice-authorized.js` and embed the image inline if present
- Optionally also render in the RIDE PDF header (currently a blank space is reserved)

**Effort:** Low.

---

## 8. Docker / Containerisation

**Priority: Low — depends on deployment target**

Not needed if deploying to a PaaS (Railway, Render, Fly.io). Useful for self-hosted VPS deployments or local onboarding.

**What:**
- `Dockerfile` (multi-stage: build → production image)
- `docker-compose.yml` with app + PostgreSQL services for local development
- Health endpoint (item 2) required for container liveness probes

**Effort:** Low.

---

## 9. Reporting

**Priority: Low — depends on client requirements**

Not a core API feature. Only worth building once a client explicitly needs it.

**What:**
- Revenue summaries by issuer, date range, document type
- Document counts by status
- CSV export

**Effort:** Medium — multiple query endpoints, no architectural changes needed.
