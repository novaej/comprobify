# CLAUDE.md

Primary guide for AI coding assistants. This file is loaded automatically into context. Every rule here takes precedence over AI defaults.

---

## Project Overview

**SRI Electronic Invoice API** — Node.js/Express REST API for generating, digitally signing, and submitting electronic invoices (*facturas electrónicas*) to Ecuador's SRI. Full document lifecycle: Generate → Sign → Send → Authorize. PostgreSQL for persistence.

---

## Commands

```bash
npm start                 # start server (default port 8080)
npm run migrate           # apply SQL migrations
npm test                  # all tests
npm run test:unit         # unit tests only (no DB required)
npm run test:integration  # integration tests (requires test DB)
```

---

## Architecture

```
Route → Validator → Controller → Service → Model / Builder / Helper
```

**Dependency rule:** each layer calls only the layer below it. Controllers never touch models. Services never touch `req`/`res`.

```
src/routes/        URL definitions + validator chains
src/validators/    express-validator field rules
src/middleware/    asyncHandler, validateRequest, errorHandler, idempotency, authenticate, rate-limit, verify-mailgun-webhook
src/controllers/   thin HTTP handlers — one service call, one response
src/services/      business logic and orchestration
src/services/email/  email provider factory + Mailgun provider + templates
src/models/        PostgreSQL CRUD (parameterised queries only)
src/builders/      XML document construction (builder registry)
src/errors/        AppError → ValidationError / NotFoundError / SriError / ConflictError / QuotaExceededError
helpers/           signer.js (XAdES-BES), access-key-generator.js (Module 11), ride-builder.js (RIDE PDF)
db/migrations/     SQL migration files 001–035
assets/            factura_V2.1.0.xsd + xmldsig-core-schema.xsd
```

---

## CRITICAL RULES

1. **English only** — all identifiers, file names, table names, column names. Spanish only where SRI mandates it (XML element names: `infoTributaria`, `claveAcceso`, SOAP payloads).
2. **Never string-interpolate SQL** — always use `$1, $2` parameterised placeholders.
3. **Never skip layers** — controller → service → model. Never controller → model.
4. **Never read `process.env` directly** — import from `src/config/index.js`.
5. **Validate before signing** — XSD validation runs before the expensive crypto step.
6. **Always log an ERROR audit event before re-throwing** from a SRI service catch block.
7. **No hard deletes** — set `active = false` or update status instead.
8. **Wrap all async route handlers** in `asyncHandler` — never add try/catch in controllers.

---

## Key Patterns

**Sequential numbers:** `SELECT ... FOR UPDATE` inside an explicit transaction — guarantees no duplicate sequential numbers under concurrent load. See `src/services/sequential.service.js`.

**Certificate storage:** private key PEM stored AES-256-GCM encrypted in `issuers.encrypted_private_key`; certificate PEM stored plaintext in `issuers.certificate_pem`. Decrypted at signing time only. Encryption key lives in `ENCRYPTION_KEY` env var.

**Multi-branch support:** one RUC can have multiple issuer rows with different `(branch_code, issue_point_code)` pairs. When creating a branch, supply `sourceIssuerId` instead of a P12 file — the admin service copies `encrypted_private_key`, `certificate_pem`, `cert_fingerprint`, `cert_expiry` from the source row. See `POST /api/admin/issuers`.

**Tenant model:** `tenants` is the root billing entity. One tenant owns one or more issuers (limited by tier). Fields: `email`, `subscription_tier` (FREE/STARTER/GROWTH/BUSINESS), `status` (PENDING_VERIFICATION/ACTIVE/SUSPENDED), `invoice_count`, `invoice_quota`. Tenants are NOT user accounts — no password, no session. The API key IS the credential. `src/constants/subscription-tiers.js` defines quota, issuer limits, and rate limits per tier.

**Self-service registration:** `POST /api/register` (public) — creates tenant + issuer + sandbox API key in one call. Tenant starts PENDING_VERIFICATION. A verification email is sent (fire-and-forget). The returned API key is shown once. `GET /api/verify-email?token=xxx` activates the tenant. Unverified tenants can use sandbox but cannot promote to production.

**User-facing promotion:** `POST /api/issuers/promote` (authenticated) — checks tenant is ACTIVE, promotes the issuer, revokes sandbox keys, creates and returns a new production key. This is one-way.

**Admin API:** `ADMIN_SECRET` env var (64-char hex) protects all `/api/admin/*` routes via `src/middleware/authenticate-admin.js` (constant-time comparison) with a 20 req/min IP-based rate limiter. Admin tenant routes: create (status ACTIVE, no verification), list, update tier, update status (activate/suspend), manual verify. Admin issuer routes: create (requires `tenantId`), list, promote (override, no tenant status check). Admin key routes: create, revoke.

**API key environment scoping:** every `api_keys` row has an `environment` column (`'sandbox'` or `'production'`) stamped at creation from the issuer's current `sandbox` flag. The `authenticate` middleware rejects a key whose environment no longer matches the issuer, and rejects requests from SUSPENDED tenants (403). `findByKeyHash` joins `tenants` and returns `tenant_*` columns; `authenticate` splits these into `req.tenant`.

**Invoice quota enforcement:** at the start of every document creation transaction, `UPDATE tenants SET invoice_count = invoice_count + 1 WHERE id = $1 AND invoice_count < invoice_quota RETURNING id` runs atomically. If no row returns, a `QuotaExceededError` (402 QUOTA_EXCEEDED) is thrown and the transaction rolls back.

**Tier-aware rate limiting:** `writeLimiter` and `readLimiter` in `src/middleware/rate-limit.js` read `req.tenant.subscriptionTier` and return the tier's limit dynamically. `adminLimiter` is a fixed 20 req/min IP-based limiter applied to all admin routes.

**Certificate parsing:** extracted to `src/services/certificate.service.js` — used by both `registration.service.js` and `admin.service.js`.

**XSD validation:** `xmllint` CLI via `execFileSync` against `assets/factura_V2.1.0.xsd`. Must be pre-validation (before signing). `xmllint` must be installed on the server.

**Retry logic:** `fetchWithRetry` in `sri.service.js` — retries only on `fetch` throws (network), never on HTTP-level SRI responses.

**Error responses:** all `4xx`/`5xx` responses use RFC 7807 Problem Details (`Content-Type: application/problem+json`) with `type`, `title`, `status`, `code` (stable SCREAMING_SNAKE_CASE i18n key), `detail`, and `instance` (request URL). `AppError` derives `code`/`type`/`title` from the HTTP status automatically; `ValidationError` and `SriError` override with domain-specific values. Field-level errors in `ValidationError.errors[]` each carry a `code` derived from the field path with array indices stripped. See ADR-011.

**Audit trail:** every lifecycle transition → `document_events` row. Event types: `CREATED`, `SENT`, `STATUS_CHANGED`, `ERROR`, `REBUILT`, `EMAIL_SENT`, `EMAIL_FAILED`, `EMAIL_DELIVERED`, `EMAIL_TEMP_FAILED`, `EMAIL_COMPLAINED`.

**Tenant event log:** `tenant_events` mirrors the document audit trail for tenant-level lifecycle events. Event types: `VERIFICATION_EMAIL_SENT`, `VERIFICATION_EMAIL_FAILED`, `VERIFICATION_EMAIL_DELIVERED`, `VERIFICATION_EMAIL_TEMP_FAILED`, `VERIFICATION_EMAIL_COMPLAINED`, `EMAIL_VERIFIED`. Written by `registration.service.js` and `mailgun-webhook.service.js`. Uses `db.query()` directly — tenants are not issuer-scoped. Adding a new event type requires updating the `chk_tenant_events_event_type` CHECK constraint in a migration.

**Builder registry:** `src/builders/index.js` maps document type codes to builder classes. Adding a new document type = new builder + one registry entry. `SUPPORTED_TYPES` (exported from `src/builders/index.js`) is derived from the registry keys and used by validators and `issuer.service.js` to enforce type eligibility. When adding a new builder, `SUPPORTED_TYPES` automatically includes it — no manual update needed.

**Issuer document types:** `issuer_document_types` table records which document types each issuer is allowed to use. Defaults to `['01']` at registration/admin create. Checked at document creation time — attempting to create a disallowed type returns 400. Managed via `GET/POST/DELETE /api/issuers/document-types`. At promotion, production sequentials are seeded for all active types (using `initialSequentials` values if provided, otherwise 1). Adding a new document type to the system requires a new builder, not a migration.

**Idempotency key:** `POST /api/documents` accepts an optional `Idempotency-Key` header. The key and a SHA-256 hash of the request body are stored in `documents.idempotency_key` / `documents.payload_hash`. A duplicate key with the same payload returns the existing document (200). A duplicate key with a different payload throws `ConflictError` (409). Concurrent races are handled by catching `23505` in the transaction rollback path. See `src/middleware/idempotency.js` and ADR-006.

**Email delivery:** when a document becomes `AUTHORIZED`, `emailService.sendInvoiceAuthorized()` is called fire-and-forget. It generates the RIDE PDF and XML on the fly and sends both as attachments via Mailgun. The Mailgun message ID (angle brackets stripped) is stored in `documents.email_message_id`. Per-document status tracked in `documents.email_status` (`PENDING` → `SENT` / `FAILED` / `SKIPPED`). Failed sends retried via `POST /email-retry` (batch) or `POST /:key/email-retry` (single, add `?force=true` to resend an already-sent email). Provider swappable via `EMAIL_PROVIDER` env var + new file in `src/services/email/providers/`.

**Mailgun webhook:** `POST /api/mailgun/webhook` receives Mailgun delivery events and updates `email_status`: `delivered` → `DELIVERED`, `failed`+`permanent` → `FAILED`, `failed`+`temporary` → status unchanged + `EMAIL_TEMP_FAILED` event (Mailgun retries), `complained` → `COMPLAINED`. All requests verified with HMAC-SHA256 via `verify-mailgun-webhook.js` middleware (`MAILGUN_WEBHOOK_SIGNING_KEY` config key). Lookup is by `documents.email_message_id`. See ADR-010.

**Rate limiting:** per-API-key request rate limits prevent abuse and quota exhaustion. Applied via `src/middleware/rate-limit.js` using `express-rate-limit`: 60 req/min on write endpoints (POST), 300 req/min on read endpoints (GET). Keyed by `req.keyHash` (SHA-256 token hash). Returns RFC 7807 `429 TOO_MANY_REQUESTS` response. Configurable via `RATE_LIMIT_WINDOW_MS` (default: 60000ms) and `RATE_LIMIT_MAX` (default: 60) env vars. See `docs/site/errors/too-many-requests.md` for client retry guidance.

**Sandbox environment + SRI routing:** `APP_ENV` (`staging` | `production`) combined with `issuers.sandbox` (boolean, default `true`) controls which SRI SOAP endpoint is used and what `ambiente` digit is embedded in the access key and XML.

| `APP_ENV`    | `issuer.sandbox = true` | `issuer.sandbox = false` |
|---|---|---|
| `staging`    | SRI test, `ambiente = 1` | SRI test, `ambiente = 1` |
| `production` | SRI test, `ambiente = 1` | SRI production, `ambiente = 2` |

`document-creation.service.js` and `document-rebuild.service.js` compute `ambiente = (config.appEnv !== 'production' || issuer.sandbox) ? '1' : '2'` and pass an `effectiveIssuer` (with `environment` set to the computed value) to both the builder and `accessKeyService.generate()`. `sri.service.js` `getSriUrls(issuer)` applies the same logic. All existing issuers default to `sandbox = true` on upgrade — safe mode until explicitly promoted.

**Sandbox PostgreSQL schema:** sandbox and production documents live in separate schemas (`sandbox` vs `public`) so sequential sequences are fully independent and test data can be truncated safely. The `sandbox` schema contains `documents`, `document_line_items`, `document_events`, `sequential_numbers`, and `sri_responses` with the same constraints, triggers, and RLS as `public`. **Every future migration that alters a tenant-scoped table must be applied to both schemas.**

**Row-Level Security (RLS):** all tenant-scoped tables (`documents`, `document_line_items`, `document_events`, `sequential_numbers`, `api_keys`) have RLS enabled via migration 031. The policy restricts every query to the current issuer by reading `app.current_issuer_id` — a transaction-local PostgreSQL setting. Two helpers in `src/config/database.js` manage this:
- `db.setIssuerContext(client, issuerId, sandbox)` — call after `BEGIN` on an existing transaction client; sets both `app.current_issuer_id` (for RLS) and `search_path` (`sandbox, public` or `public`), both rolled back automatically on abort.
- `db.queryAsIssuer(issuerId, sql, params, sandbox)` — wraps a single query in a mini BEGIN / set_config / SET LOCAL search_path / query / COMMIT for non-transactional reads.
All authenticated service code paths must use one of these two helpers. Only the Mailgun webhook, admin API, and health check are exempt — they authenticate by other means and operate without an issuer context (the policy's null bypass allows it). The application DB user must **not** be a PostgreSQL superuser; superusers always bypass RLS regardless of policies.

**Config validation:** critical environment variables are validated at startup in `src/config/validate.js` and called from `app.js` before `Server` construction. Always-required: `APP_ENV` (`staging` | `production`), `ENCRYPTION_KEY` (64-char hex format), `ADMIN_SECRET`. Email-required when `EMAIL_PROVIDER` is set to anything other than `'none'`: `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `EMAIL_FROM`. If any are missing or malformed, the process throws immediately with a clear error message before accepting any HTTP requests. This prevents silent failures like unsigned webhooks or unencrypted P12 storage.

---

## Document Lifecycle

```
POST /api/documents             → SIGNED   (Idempotency-Key header optional, documentType defaults to '01')
POST /:key/send                 → RECEIVED | RETURNED
GET  /:key/authorize            → AUTHORIZED | NOT_AUTHORIZED  (+fires email)
POST /:key/rebuild              → SIGNED  (from RETURNED or NOT_AUTHORIZED)
GET  /:key/ride                 → application/pdf  (AUTHORIZED only)
GET  /:key/xml                  → application/xml  (authorization XML or signed XML)
GET  /:key/events               → audit trail for the document
POST /email-retry               → batch retry all PENDING/FAILED emails
POST /:key/email-retry          → retry single email (?force=true to resend SENT)
POST /api/mailgun/webhook       → Mailgun delivery event → update email_status (HMAC-verified)
```

`rebuild` corrects invoice content (taxes, items, buyer, payments) and re-signs using the same `access_key`, `sequential`, and `issue_date`. Used when SRI returns RETURNED or NOT_AUTHORIZED.

**Invoice generation steps:**
1. Idempotency check — if key seen + hash matches, return existing doc immediately
2. Issuer provided via `req.issuer` (set by `authenticate` middleware from API key)
3. `SELECT ... FOR UPDATE` → next sequential
4. Generate 49-digit access key (Module 11 check digit)
5. Build unsigned XML (`InvoiceBuilder`)
6. Validate against XSD (`xmllint`)
7. Sign XML (XAdES-BES, PEM private key + cert from `issuers` row)
8. Read `buyer_email` from `body.buyer.email` (required field)
9. `INSERT` into `documents` (with `idempotency_key`, `payload_hash`, `buyer_email`)
10. `bulkCreate` into `document_line_items`
11. Log `CREATED` event to `document_events`

---

## Git Commit Conventions

Format: `type: short description` (max 72 chars, imperative mood, no period)

| Type | Use for |
|------|---------|
| `feat` | new feature |
| `fix` | bug fix |
| `refactor` | code change with no behaviour change |
| `docs` | documentation only |
| `test` | adding or fixing tests |
| `chore` | dependencies, tooling, config |
| `ci` | CI/CD pipeline changes |

```
feat: add credit note document type
fix: resolve duplicate sequential on concurrent requests
refactor: extract XSD validation into separate service
docs: add ADR for sequential locking strategy
chore: update express to 4.22.1
```

---

## Common Mistakes to Avoid

1. Calling a model directly from a controller — always go through the service.
2. String-interpolating SQL — use `$1, $2` always.
3. Throwing `new Error()` instead of an `AppError` subclass — the error handler returns a generic 500.
4. Forgetting `asyncHandler` on a route — async errors are swallowed silently.
5. Forgetting `validateRequest` in the route chain — validator runs but errors are never checked.
6. Signing before XSD validation — signing is expensive; fail fast.
7. Retrying on HTTP-level SRI errors — only retry on `fetch` throws.
8. Not logging an `ERROR` audit event before re-throwing — leaves a gap in the document history.
9. Reading `process.env` directly in a service or model — use `src/config/index.js`.
10. Hardcoding Spanish identifiers in new code — use English everywhere except SRI XML elements.
11. Generating a new idempotency key on every retry — the key must be generated once and reused across retries for the same intended invoice.
12. Adding a new `document_events` event type without updating the `chk_document_events_event_type` CHECK constraint — the INSERT will fail silently if the constraint is not updated in a migration.
13. Calling `db.query()` directly in an authenticated service or model — use `db.queryAsIssuer(issuerId, sql, params, sandbox)` instead so both RLS and the correct `search_path` are set. `db.query()` (no issuer context) is only correct for the webhook, admin, and health code paths.
14. Adding a migration that alters a tenant-scoped table (`documents`, `document_line_items`, `document_events`, `sequential_numbers`, `sri_responses`) without also applying the same DDL to the `sandbox` schema — the schemas must stay structurally identical.
15. Passing `issuer.environment` directly to `accessKeyService.generate()` or the XML builder — always derive `ambiente` from `config.appEnv` and `issuer.sandbox` first, then build an `effectiveIssuer` with the computed value. Using the raw DB field bypasses the staging safety rail and could embed `ambiente = 2` in a document sent to the test endpoint.

---

## Key Files

| File | Purpose |
|------|---------|
| `GETTING_STARTED.md` | Local setup guide |
| `docs/guides/documentation-checklist.md` | **Master reference: what docs to update for each change type** |
| `docs/guides/code-flow.md` | Layer-by-layer request walkthrough |
| `docs/guides/coding-guidelines.md` | Patterns and examples for adding features |
| `docs/adr/` | Architecture Decision Records |
| `src/config/validate.js` | Startup config validation — throws if critical env vars are missing or malformed |
| `src/middleware/authenticate.js` | Bearer token → SHA-256 → DB lookup → `req.issuer` + `req.tenant`; checks suspension + env mismatch |
| `src/middleware/authenticate-admin.js` | `ADMIN_SECRET` constant-time check for `/api/admin/*` |
| `src/middleware/rate-limit.js` | Tier-aware per-key rate limiting + `adminLimiter` (20 req/min IP-based) |
| `src/middleware/idempotency.js` | Extracts + validates `Idempotency-Key` header |
| `src/middleware/verify-mailgun-webhook.js` | HMAC-SHA256 + replay protection for Mailgun webhook |
| `src/services/document-creation.service.js` | Invoice creation — sequential, XML, signing, persistence |
| `src/services/document-transmission.service.js` | SRI send + authorization check + fire-and-forget email |
| `src/services/document-rebuild.service.js` | Rebuild from RETURNED/NOT_AUTHORIZED |
| `src/services/document-email.service.js` | Batch and single email retry |
| `src/services/document-query.service.js` | Read-only document lookups |
| `src/services/email.service.js` | Sends RIDE PDF + XML on authorization via provider; returns `{ sent, messageId }` |
| `src/services/email/index.js` | Email provider factory (`EMAIL_PROVIDER` env var) |
| `src/services/email/providers/mailgun.provider.js` | Mailgun SDK wrapper; returns `{ messageId }` (angle brackets stripped) |
| `src/services/mailgun-webhook.service.js` | Normalises Mailgun v3/legacy payload, looks up doc by `email_message_id`, updates status |
| `src/controllers/mailgun-webhook.controller.js` | Thin handler for `POST /api/mailgun/webhook` |
| `src/routes/mailgun-webhook.routes.js` | Mounts webhook route with HMAC verification |
| `src/services/email/templates/invoice-authorized.js` | Spanish email subject + text + HTML |
| `src/services/ride.service.js` | RIDE PDF generation — on-demand, not persisted |
| `src/services/sri.service.js` | SRI SOAP integration + retry logic |
| `src/services/xml-validator.service.js` | XSD pre-validation via xmllint (async) |
| `src/services/sequential.service.js` | FOR UPDATE sequential locking |
| `src/presenters/document.presenter.js` | `formatDocument()` — shared response shape |
| `src/models/tenant.model.js` | Tenant CRUD — `create`, `findByEmail`, `findByVerificationToken`, `activate`, `updateTier`, `updateStatus`, `updateVerificationToken`, `updateVerificationEmailSent`, `updateVerificationEmailStatus`, `findByVerificationEmailMessageId`, `countIssuersByTenantId` |
| `src/models/tenant-event.model.js` | Tenant event log — `create`, `findByTenantId`; uses `db.query()` (not issuer-scoped) |
| `src/services/certificate.service.js` | P12 parsing — shared by registration and admin service |
| `src/services/registration.service.js` | Self-service registration + resend verification — creates tenant + issuer + sandbox API key; logs tenant events |
| `src/controllers/registration.controller.js` | Handlers for `POST /api/register`, `POST /api/resend-verification`, and `GET /api/verify-email` |
| `src/routes/registration.routes.js` | Public registration, resend-verification, and email verification routes |
| `src/routes/issuers.routes.js` | Authenticated issuer routes: promote, document type list/add/remove |
| `src/controllers/issuer.controller.js` | Handlers for promote and document type management |
| `src/services/issuer.service.js` | `listDocumentTypes`, `addDocumentType`, `removeDocumentType` — validates against `SUPPORTED_TYPES` |
| `src/models/issuer-document-type.model.js` | `bulkCreate`, `findActiveByIssuerId`, `activate`, `deactivate` — uses `db.query()` (not issuer-scoped) |
| `src/constants/subscription-tiers.js` | Tier definitions: quota, issuer limits, rate limits |
| `src/services/admin.service.js` | Tenant + issuer + API key management |
| `src/controllers/admin.controller.js` | Thin HTTP handlers for admin routes |
| `src/routes/admin.routes.js` | `/api/admin/*` — admin auth + rate limit, tenant/issuer/key CRUD |
| `src/models/api-key.model.js` | API key CRUD — `findByKeyHash` (joins tenants), `create`, `revoke` |
| `src/errors/conflict-error.js` | AppError subclass for HTTP 409 |
| `src/errors/quota-exceeded-error.js` | AppError subclass for HTTP 402 QUOTA_EXCEEDED |
| `src/builders/index.js` | Builder registry |
| `helpers/ride-builder.js` | PDFKit A4 RIDE renderer (Code 128 barcode via bwip-js) |
| `src/constants/document-state-machine.js` | `TRANSITIONS` map + `canTransition` / `assertTransition` |
| `src/config/database.js` | pg Pool + `query` (bypass) + `setIssuerContext(client, issuerId, sandbox)` + `queryAsIssuer(issuerId, sql, params, sandbox)` — sets both RLS context and `search_path` |
| `db/migrations/` | SQL migration files 001–035 (031: RLS; 032: sandbox on issuers; 033: sandbox schema; 034: api_key environment; 035: tenants) |
| `assets/factura_V2.1.0.xsd` | Official SRI invoice schema |
| `.example.env` | Environment variable template |
