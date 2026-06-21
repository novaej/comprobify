# Next Steps

Remaining work ordered by value-to-effort ratio. Each item is independent and can be delivered as its own PR.

See [STRATEGY.md](STRATEGY.md) for product context, pricing model, and phased roadmap.

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

## 2. Async Worker for SRI Submission

**Priority: Medium — important for production reliability**

`POST /:key/send` and `GET /:key/authorize` block the HTTP request while waiting for SRI's SOAP response (typically 5–30 s, can time out). This causes long-hanging requests and poor client experience under load.

**What:**
- `PROCESSING_MODE` env var: `sync` (current default) | `async`
- New `PENDING_SEND` status: document queued for transmission
- In async mode: `POST /:key/send` → sets `PENDING_SEND`, returns 202 immediately
- Worker polls `PENDING_SEND` documents with `SELECT ... FOR UPDATE SKIP LOCKED` → submits to SRI → updates status
- Worker also polls `RECEIVED` documents older than N minutes to check authorization
- State machine and DB trigger must be updated to allow `SIGNED → PENDING_SEND`

**Effort:** High — new worker process, new status, migration, state machine update. Pairs well with webhook notifications to push async results to clients.

---

## 3. Docker / Containerisation

**Priority: Low — depends on deployment target**

Not needed if deploying to a PaaS (Railway, Render, Fly.io). Useful for self-hosted VPS deployments or local onboarding.

**What:**
- `Dockerfile` (multi-stage: build → production image)
- `docker-compose.yml` with app + PostgreSQL services for local development
- Health endpoint required for container liveness probes

**Effort:** Low.

---

## 4. Dashboard Stats Endpoint

**Priority: Medium — needed for comprobify-web dashboard**

`GET /v1/documents/stats` returns a per-type breakdown for the current month plus an all-time "needs attention" count. Frontend computes net revenue from the breakdown (FAC + LIQ + DEB − CRE from `authorizedTotal` values).

**Response shape:**
```json
{
  "ok": true,
  "stats": {
    "thisMonth": {
      "byType": [
        { "type": "FAC", "issued": 5, "authorizedTotal": "1800.00" },
        { "type": "CRE", "issued": 2, "authorizedTotal": "260.00" }
      ]
    },
    "needsAttention": 3
  }
}
```

**Field rules:**
- `byType` — only types with at least one document issued this month (omit empty types)
- `authorizedTotal` — sum of `total` for `AUTHORIZED` docs, decimal string `"0.00"` if none
- `needsAttention` — count of `RETURNED` or `NOT_AUTHORIZED` docs, all-time
- REM / RET included in `byType` with `authorizedTotal = "0.00"` (no monetary value)

**Type code mapping** (DB → response):
`'01'→FAC`, `'03'→LIQ`, `'04'→CRE`, `'05'→DEB`, `'06'→REM`, `'07'→RET`

**Implementation:**
1. `document.model.js` — add `getStats(issuerId, sandbox)`: two queries inside a single `getClient()` transaction with `setIssuerContext` (monthly GROUP BY document_type + all-time RETURNED/NOT_AUTHORIZED count)
2. `document-query.service.js` — add `getStats(issuer)`: maps DB codes to friendly names, formats `authorizedTotal` as decimal strings
3. `documents.controller.js` — add `getStats` handler
4. `documents.routes.js` — add `GET /stats` **before** `GET /:accessKey` (route ordering critical)

**SQL (monthly):**
```sql
SELECT document_type,
       COUNT(*) AS issued,
       COALESCE(SUM(CASE WHEN status = 'AUTHORIZED' THEN total END), 0) AS authorized_total
FROM documents
WHERE issuer_id = $1
  AND issue_date >= DATE_TRUNC('month', CURRENT_DATE)
  AND issue_date <  DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
GROUP BY document_type
```

**Effort:** Low — no migration, no new tables, fits existing patterns exactly.

---

## 5. API Key Usage Tracking

**Priority: Medium — observability for named integrations**

Rate limiting is already per `keyHash` (in-memory, enforces throttling). But there is no persistent usage record per key — request counts reset on restart and there is no way to answer "how many requests did the ERP integration make last month?" With tenant-scoped keys, this is the only way to slice traffic per integration (`frontend-prod`, `erp`, `mobile`, etc.); per-issuer slicing is already derivable from `documents.issuer_id`.

**What to track (add to `api_keys` table):**
- `last_used_at TIMESTAMPTZ` — updated on every authenticated request
- `request_count BIGINT NOT NULL DEFAULT 0` — lifetime request counter, incremented on every authenticated request

**Implementation:**
1. Migration — `ALTER TABLE api_keys ADD COLUMN last_used_at TIMESTAMPTZ, ADD COLUMN request_count BIGINT NOT NULL DEFAULT 0`
2. `authenticate` middleware — after a successful key lookup, fire a background `UPDATE api_keys SET last_used_at = NOW(), request_count = request_count + 1 WHERE id = $1` (no `await` — fire and forget, does not block the request)
3. Admin / tenant key list endpoints — expose `lastUsedAt` and `requestCount` in the response so operators can see activity per integration

**What this enables:**
- Identify dormant integrations (key never used or `last_used_at` months ago)
- Spot an integration generating unexpectedly high volume
- Revoke a compromised key with confidence that the request spike matches the revocation event
- Audit trail: `created_at` + `last_used_at` + `request_count` per key tells the full lifecycle story

**Notes:**
- `request_count` is a monotonic counter, not windowed — for windowed analytics use structured logs (item 8) or an APM tool
- The background UPDATE is a single indexed write per request (`WHERE id = $1`); acceptable overhead for the observability gain
- Per-issuer document volume is already derivable from `documents.issuer_id` — this adds the per-integration request-level dimension

**Effort:** Low — one migration, ~3 lines in the authenticate middleware, small admin response change.

---

## 6. Reporting

**Priority: Low — depends on client requirements**

Not a core API feature. Only worth building once a client explicitly needs it.

**What:**
- Revenue summaries by issuer, date range, document type
- Document counts by status
- CSV export

**Effort:** Medium — multiple query endpoints, no architectural changes needed.

---

## 7. Registration DoS Monitoring

**Priority: Low — risk mitigation**

`POST /v1/register` is now idempotent: calling it with an existing email revokes the current sandbox key and issues a new one. This is intentional for frontend recovery, but a bad actor could loop it to continuously invalidate a tenant's key.

The existing `registrationLimiter` (5 req/hour per IP) limits per-IP burst, but does not detect distributed multi-IP abuse targeting a single email.

**What:**
- Structured log entry whenever a recovery key is issued (email, IP, timestamp) — already distinguishable via the `recovered: true` flag in the service response
- Alert rule (e.g., Datadog / Grafana) firing when the same email sees >3 recovery key issuances within a rolling 1-hour window
- Optionally: add an `api_key_recovery_count` counter to `tenants` and expose it in the admin tenant detail response so operators can spot abuse manually

**Effort:** Low (logging only) to Medium (alerting infrastructure).

---

## 8. Structured Request Logging

**Priority: Medium — important for a B2B API where documents have legal weight**

No log aggregation is currently in place. Without it there is no way to debug a client's failed integration, investigate a SRI timeout, audit a quota dispute, or detect a compromised API key being used from an unexpected IP before the tenant notices.

**What to log (one JSON line per request):**
- `timestamp`, `method`, `path`, `statusCode`, `durationMs`
- `keyHash` (never the plaintext key), `apiKeyId`, `tenantId`, `issuerId`
- `requestId` (UUID injected by middleware for correlation)

With tenant-scoped API keys, `apiKeyId` identifies the integration (e.g. `frontend-prod` vs `erp`) and `issuerId` identifies which branch the request targeted — the two dimensions slice traffic independently.

**What this enables:**
- **Client debugging** — look up a key hash and see exactly what was sent and what the API returned, without needing the client to reproduce
- **SRI failure investigation** — the document event log captures outcomes but not timing; logs capture slow or intermittently failing SRI SOAP calls
- **Quota disputes** — per-request audit trail independent of the `document_count` counter
- **Security** — detect a leaked key used from an unexpected IP before the tenant reports it; especially important given documents have legal standing under Ecuadorian tax law

**Implementation:**
1. Add `express-winston` (or a thin custom middleware) to emit one structured JSON log line per request after the response is sent — attach `tenantId`, `issuerId`, `keyHash` from `req` after `authenticate` runs
2. Ship logs to **Datadog** or **Betterstack** (both have free tiers; Betterstack integrates in ~10 lines for Node)
3. The item 5 `request_count` counter on `api_keys` still has value as a cheap "is this key alive" check without a log query — these two are complementary, not alternatives

**Note:** log the `keyHash`, never the plaintext token. All sensitive fields (`encrypted_private_key`, cert PEM, passwords) must be excluded.

**Effort:** Low — one middleware, one external service connection, no migrations.

---

## 9. API Key Scopes

**Priority: Low — defer until first concrete use case**

Today every API key can do everything its tenant can do. Scopes would let tenants mint a read-only key (e.g. for a dashboard pulling stats) without the ability to issue or void documents.

**Proposed scope vocabulary:**
- `documents:write` — create, send, rebuild, authorize, email-retry
- `documents:read` — list, get, ride, xml, events, stats
- `documents:void` — voiding endpoints (when added)
- `issuers:manage` — promote, create branch, document-type management

**Implementation outline:**
1. Migration — `ALTER TABLE api_keys ADD COLUMN scopes TEXT[] NOT NULL DEFAULT ARRAY['documents:write','documents:read','issuers:manage']` (full-access default preserves current behaviour)
2. Tenant key-creation endpoint accepts a `scopes` array, validated against the vocabulary
3. New `requireScope('documents:read')` middleware factory; mounted per-route alongside `authenticate` / `resolveIssuer`
4. Surface scopes in `GET /v1/keys` so operators can audit each integration's blast radius

**Why defer:** there is no client today asking for a read-only key. Adding scopes preemptively means writing validation, tests, and docs for code paths nobody is using. Revisit when the first dashboard / read-only consumer appears, or when a security review demands principle-of-least-privilege.

**Effort:** Low–Medium when the use case arrives — migration + one middleware factory + 4–8 route annotations + tests.
