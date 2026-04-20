# Next Steps

Remaining work ordered by value-to-effort ratio. Each item is independent and can be delivered as its own PR.

See [STRATEGY.md](STRATEGY.md) for product context, pricing model, and phased roadmap.

---

## ✅ 1. Rate Limiting — COMPLETED

Per-API-key rate limiting implemented (60 req/min write, 300 req/min read). See `src/middleware/rate-limit.js` and `docs/site/errors/too-many-requests.md`.

---

## 1. Additional Document Types

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

## ✅ 2. Health Endpoint — COMPLETED

`GET /health` checks DB connectivity and returns `{ status: "ok", uptime }` (200) or `{ status: "error", uptime }` (503). No authentication. Mounted outside `/api`. See `src/routes/health.routes.js`, `src/controllers/health.controller.js`, `src/services/health.service.js`.

---

## ✅ 3. PostgreSQL Row-Level Security (RLS) — COMPLETED

Migration 031 enables RLS + `FORCE ROW LEVEL SECURITY` on `documents`, `document_line_items`, `document_events`, `sequential_numbers`, and `api_keys`. Policies restrict rows to `issuer_id = current_setting('app.current_issuer_id', true)::bigint`. The `db.setIssuerContext()` and `db.queryAsIssuer()` helpers in `src/config/database.js` set this context for all authenticated code paths. Webhook/admin/health paths operate without issuer context and are covered by the policy's null bypass. **The application database user must not be a PostgreSQL superuser.**

---

## 4. Sandbox Environment (SRI Test/Production Routing)

**Priority: High — implement before onboarding paying clients**

Users need to validate their integration against SRI's test environment before switching to production. The `sandbox` flag on an issuer controls which SRI endpoint is used. A separate app-level safety rail ensures staging never hits SRI production regardless of the flag.

**Routing logic:**

| App env | `issuer.sandbox = true` | `issuer.sandbox = false` |
|---|---|---|
| staging | SRI test endpoint | SRI test endpoint |
| production | SRI test endpoint | SRI production endpoint |

**Schema separation:**

Sandbox and production documents live in separate PostgreSQL schemas (`sandbox` and `public`) to prevent data mixing, protect sequential number sequences, and allow safe truncation of test data without touching production records.

**What:**
1. Migration: add `sandbox BOOLEAN NOT NULL DEFAULT true` to `issuers` — all existing issuers default to safe/test mode until explicitly promoted
2. Create `sandbox` PostgreSQL schema with identical structure to `public` — all future migrations must be applied to both schemas
3. `sri.service.js`: derive `const useTest = appEnv !== 'production' || issuer.sandbox` — select SRI WSDL URL accordingly
4. `InvoiceBuilder` / `access-key-generator.js`: pass `ambiente` (`1` = pruebas, `2` = producción) using the same logic — this value is embedded in the 49-digit access key
5. DB connection layer (`db.js`): set `search_path` to `sandbox` or `public` per request based on `req.issuer.sandbox`
6. Admin API: expose `sandbox` field on issuer create and list endpoints
7. Config: add `APP_ENV` env var (`staging` | `production`) read via `src/config/index.js`; add to `src/config/validate.js` required list

**Why schema separation over a `sandbox` column on every table:**
- Sequential numbers are naturally scoped to an issuer row, but the issuer itself spans both contexts — a column-per-table approach requires `WHERE sandbox = $1` on every query and risks sequence pollution
- Test data can be freely truncated or reset without touching `public` schema
- Production reporting queries on `public` never surface test invoices, even if a filter is accidentally omitted

**Effort:** Medium — migration, `sandbox` schema creation, db connection routing, SRI endpoint selection, `ambiente` flag propagation through builder and access-key generator.

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

**Effort:** High — new worker process, new status, migration, state machine update. Pairs well with outbound webhooks (item 4) to notify clients of async results.

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
