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
db/migrations/     SQL migration files 001–050
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

**Issuer logo:** stored as `BYTEA` in `issuers.logo` (migration 050; replaces the dropped `logo_path` column). Two upload paths: optional `logo` field on `POST /v1/register` (multipart, validated in `registration.controller.js`), or `PATCH /v1/issuers/:id/logo` for an existing issuer (PNG/JPEG/GIF, max 500 KB). The registration multer instance has a 10 MB **whole-request** `fileSize` limit (it must also accommodate the P12 cert upload), so the 500 KB logo cap cannot be enforced by multer there — `registration.controller.js` checks `logoFile.size` manually and throws `INVALID_FILE_UPLOAD` if exceeded. The dedicated logo-upload route's multer instance has no other file fields, so its `limits: { fileSize: 500 * 1024 }` enforces the cap natively. `ride.service.js` reads `issuer.logo` and passes it to `helpers/ride-builder.js`, which renders it in the top-left header of every RIDE PDF (including email attachments).

**Multi-branch support:** one RUC can have multiple issuer rows with different `(branch_code, issue_point_code)` pairs. When creating a branch, supply `sourceIssuerId` instead of a P12 file — the service copies `encrypted_private_key`, `certificate_pem`, `cert_fingerprint`, `cert_expiry` from the source row. Self-service endpoint is `POST /v1/issuers` (omit `sourceIssuerId` to inherit from the tenant's first existing issuer). Creating a branch does NOT mint a new API key — the tenant's existing key covers every branch via the `X-Issuer-Id` header. New branches inherit the tenant's current environment (sandbox or production).

**Tenant model:** `tenants` is the root billing entity. One tenant owns one RUC with one or more branches and issuing points (limited by tier). Fields: `email`, `subscription_tier` (FREE/STARTER/GROWTH/BUSINESS), `status` (PENDING_VERIFICATION/ACTIVE/SUSPENDED), `sandbox` (boolean, default `true`), `document_count`, `document_quota`, `preferred_language` (default `'es'`). Tenants are NOT user accounts — no password, no session. The API key IS the credential. `src/constants/subscription-tiers.js` defines per-tier `documentQuota`, `maxBranches`, `maxIssuePointsPerBranch`, and rate limits. `PATCH /v1/tenants/language` updates the preferred language after registration. `GET /v1/tenants/me` resolves identity for a holder of an API key with no other context (e.g. a third-party app linking an existing account) — it returns `req.tenant` as-is, with no DB call, since `authenticate` middleware has already resolved it from the key.

**Email localisation:** outgoing emails are localised using `src/locales/` — a cross-cutting layer shared by email templates and (in future) API responses. `getTranslations(lang)` returns the locale object for the given language code, falling back to `'es'`. Each locale file exports a plain object keyed by domain (`email.verifyEmail.*`, `email.invoiceAuthorized.*`). Templates own HTML structure; locales own strings. `SUPPORTED_LANGUAGES` exported from `src/locales/index.js` is the single source of truth for accepted language codes — used by validators on `POST /v1/register` and `PATCH /v1/tenants/language`. The invoice-authorized email is localised using the **issuer's tenant** `preferred_language` (there is no buyer-language field — `email.service.js` resolves it via `issuer.tenant_id` → `tenantModel.findById`), not the buyer's.

**Self-service registration:** `POST /v1/register` (public) — creates tenant + issuer + sandbox API key in one call. Tenant starts PENDING_VERIFICATION. A verification email is sent (fire-and-forget). The returned API key is shown once. `GET /v1/verify-email?token=xxx` activates the tenant. Unverified tenants can use sandbox but cannot promote to production. Optional `verificationRedirectUrl` field redirects the email link to a frontend page (e.g. `https://app.example.com/verify?token=xxx`) instead of directly to the API — stored on the tenant row and used for all subsequent verification emails including resends. Token TTL is configurable via `VERIFICATION_TOKEN_TTL_HOURS` (default 24h). `POST /v1/resend-verification` enforces a 60-second server-side cooldown (checked against `tenants.verification_email_sent_at`) in addition to the IP rate limit.

**User-facing promotion:** `POST /v1/tenants/promote` (authenticated) — checks tenant is ACTIVE, flips `tenants.sandbox = false`, seeds production sequentials for all issuers × document types, revokes all sandbox API keys, and creates matching production keys (one per revoked sandbox key, same label). Returns `{ apiKeys: [{ label, apiKey }] }` — all tokens shown once, store immediately. This is one-way. Admin override: `POST /v1/admin/tenants/:id/promote` (skips ACTIVE status check).

**Admin API:** `ADMIN_SECRET` env var (64-char hex) protects all `/v1/admin/*` routes via `src/middleware/authenticate-admin.js` (constant-time comparison) with a 20 req/min IP-based rate limiter. Admin tenant routes: create (status ACTIVE, no verification), list, update tier, update status (activate/suspend), manual verify. Admin issuer routes: create (requires `tenantId`), list, promote (override, no tenant status check). Admin key routes: create, revoke.

**Tenant-scoped API keys (ADR-013):** API keys belong to a tenant, not an issuer. One tenant can mint multiple named keys (e.g. `frontend-prod`, `erp`, `mobile-app`) via `GET / POST / DELETE /v1/keys`. Each key carries an `environment` column (`'sandbox'` or `'production'`). The `authenticate` middleware sets `req.tenant` + `req.apiKey` + `req.keyHash`, rejects keys for SUSPENDED tenants (403), and does NOT set `req.issuer` — issuer resolution is delegated to the next middleware.

**Per-request issuer resolution:** every authenticated document-endpoint request must include an `X-Issuer-Id` header. The `resolveIssuer` middleware (mounted on `/v1/documents/*`) fetches the issuer, validates `issuer.tenant_id === req.tenant.id` (403 ISSUER_FORBIDDEN if not), validates `req.apiKey.environment === (issuer.sandbox ? 'sandbox' : 'production')` (401 on mismatch), and sets `req.issuer`. Issuer-management routes (`/v1/issuers/:id/...`) bypass this middleware and instead read the issuer from `:id` in the URL with an inline ownership check.

**Document quota enforcement:** at the start of every document creation transaction, `UPDATE tenants SET document_count = document_count + 1 WHERE id = $1 AND document_count < document_quota RETURNING id` runs atomically. If no row returns, a `QuotaExceededError` (402 QUOTA_EXCEEDED) is thrown and the transaction rolls back.

**Tier-aware rate limiting:** `writeLimiter` and `readLimiter` in `src/middleware/rate-limit.js` read `req.tenant.subscriptionTier` and return the tier's limit dynamically. `adminLimiter` is a fixed 20 req/min IP-based limiter applied to all admin routes.

**Certificate parsing:** extracted to `src/services/certificate.service.js` — used by both `registration.service.js` and `admin.service.js`.

**XSD validation:** `xmllint` CLI via `execFileSync` against `assets/factura_V2.1.0.xsd`. Must be pre-validation (before signing). `xmllint` must be installed on the server.

**Retry logic:** `fetchWithRetry` in `sri.service.js` — retries only on `fetch` throws (network), never on HTTP-level SRI responses.

**Error responses:** all `4xx`/`5xx` responses use RFC 7807 Problem Details (`Content-Type: application/problem+json`) with `type`, `title`, `status`, `code` (stable SCREAMING_SNAKE_CASE i18n key), `detail`, and `instance` (request URL). `AppError` derives `code`/`type`/`title` from the HTTP status automatically; an optional third constructor argument overrides `code` with a domain-specific value (e.g. `new AppError(msg, 400, ErrorCodes.CERTIFICATE_EXPIRED)`). All stable codes live in `src/constants/error-codes.js` — always import from there, never hard-code strings. `ValidationError` and `SriError` subclasses override with domain-specific values (`VALIDATION_FAILED`, `SRI_SUBMISSION_FAILED`). Field-level errors in `ValidationError.errors[]` each carry a `code` derived from the field path with array indices stripped. See ADR-011 and `docs/site/errors/index.md` for the full code catalogue.

**Audit trail:** every lifecycle transition → `document_events` row. Event types: `CREATED`, `SENT`, `STATUS_CHANGED`, `ERROR`, `REBUILT`, `EMAIL_SENT`, `EMAIL_FAILED`, `EMAIL_DELIVERED`, `EMAIL_TEMP_FAILED`, `EMAIL_COMPLAINED`.

**Tenant event log:** `tenant_events` mirrors the document audit trail for tenant-level lifecycle events. Event types: `VERIFICATION_EMAIL_SENT`, `VERIFICATION_EMAIL_FAILED`, `VERIFICATION_EMAIL_DELIVERED`, `VERIFICATION_EMAIL_TEMP_FAILED`, `VERIFICATION_EMAIL_COMPLAINED`, `EMAIL_VERIFIED`. Written by `registration.service.js` and `mailgun-webhook.service.js`. Uses `db.query()` directly — tenants are not issuer-scoped. Adding a new event type requires updating the `chk_tenant_events_event_type` CHECK constraint in a migration.

**Builder registry:** `src/builders/index.js` maps document type codes to builder classes. Adding a new document type = new builder + one registry entry. `SUPPORTED_TYPES` (exported from `src/builders/index.js`) is derived from the registry keys and used by validators and `issuer.service.js` to enforce type eligibility. When adding a new builder, `SUPPORTED_TYPES` automatically includes it — no manual update needed.

**Issuer document types:** `issuer_document_types` table records which document types each issuer is allowed to use. Defaults to `['01']` at registration/admin create. Checked at document creation time — attempting to create a disallowed type returns 400. Managed via `GET/POST /v1/issuers/:id/document-types` and `DELETE /v1/issuers/:id/document-types/:code`. At promotion, production sequentials are seeded for all active types (using `initialSequentials` values if provided, otherwise 1). Adding a new document type to the system requires a new builder, not a migration.

**Idempotency key:** `POST /v1/documents` accepts an optional `Idempotency-Key` header. The key and a SHA-256 hash of the request body are stored in `documents.idempotency_key` / `documents.payload_hash`. A duplicate key with the same payload returns the existing document (200). A duplicate key with a different payload throws `ConflictError` (409). Concurrent races are handled by catching `23505` in the transaction rollback path. See `src/middleware/idempotency.js` and ADR-006.

**Email delivery:** when a document becomes `AUTHORIZED`, `emailService.sendInvoiceAuthorized()` is called fire-and-forget. It generates the RIDE PDF and XML on the fly and sends both as attachments via Mailgun. The Mailgun message ID (angle brackets stripped) is stored in `documents.email_message_id`. Per-document status tracked in `documents.email_status` (`PENDING` → `SENT` / `FAILED` / `SKIPPED`). Failed sends retried via `POST /email-retry` (batch) or `POST /:key/email-retry` (single, add `?force=true` to resend an already-sent email). Provider swappable via `EMAIL_PROVIDER` env var + new file in `src/services/email/providers/`.

**Mailgun webhook:** `POST /v1/mailgun/webhook` receives Mailgun delivery events and updates `email_status`: `delivered` → `DELIVERED`, `failed`+`permanent` → `FAILED`, `failed`+`temporary` → status unchanged + `EMAIL_TEMP_FAILED` event (Mailgun retries), `complained` → `COMPLAINED`. All requests verified with HMAC-SHA256 via `verify-mailgun-webhook.js` middleware (`MAILGUN_WEBHOOK_SIGNING_KEY` config key). Lookup is by `email_message_id` — `findByEmailMessageId` searches **both** `public.documents` and `sandbox.documents` via `UNION ALL` and returns a `sandbox` boolean on the row. That flag is passed to `updateEmailStatus` and `documentEventModel.create` so the update and audit event land in the correct schema. See ADR-010.

**Rate limiting:** per-API-key request rate limits prevent abuse and quota exhaustion. Applied via `src/middleware/rate-limit.js` using `express-rate-limit`: 60 req/min on write endpoints (POST), 300 req/min on read endpoints (GET). Keyed by `req.keyHash` (SHA-256 token hash). Returns RFC 7807 `429 TOO_MANY_REQUESTS` response. Configurable via `RATE_LIMIT_WINDOW_MS` (default: 60000ms) and `RATE_LIMIT_MAX` (default: 60) env vars. See `docs/site/errors/too-many-requests.md` for client retry guidance.

**Sandbox environment + SRI routing:** `APP_ENV` (`staging` | `production`) combined with `tenants.sandbox` (boolean, default `true`) controls which SRI SOAP endpoint is used and what `ambiente` digit is embedded in the access key and XML. `tenants.sandbox` is the **single source of truth** for a tenant's intended SRI environment — `true` means SRI test, `false` means eligible for SRI production (subject to the staging safety rail below). `issuers` no longer has an `environment` column (dropped in migration 049) — `issuer.sandbox` in all service code is a virtual field set by `resolveIssuer` middleware (`req.issuer.sandbox = req.tenant.sandbox`).

| `APP_ENV`    | `tenant.sandbox = true` | `tenant.sandbox = false` |
|---|---|---|
| `staging`    | SRI test, `ambiente = 1` | SRI test, `ambiente = 1` |
| `production` | SRI test, `ambiente = 1` | SRI production, `ambiente = 2` |

`document-creation.service.js` and `document-rebuild.service.js` compute `ambiente = (config.appEnv !== 'production' || issuer.sandbox) ? '1' : '2'` (where `issuer.sandbox` reflects `tenant.sandbox` via the virtual field) and pass an `effectiveIssuer` (with `environment` set to the computed value) to both the builder and `accessKeyService.generate()`. `sri.service.js` `getSriUrls(issuer)` applies the same logic. All tenants default to `sandbox = true` — safe mode until explicitly promoted.

**Sandbox PostgreSQL schema:** sandbox and production documents live in separate schemas (`sandbox` vs `public`) so sequential sequences are fully independent and test data can be truncated safely. The `sandbox` schema contains `documents`, `document_line_items`, `document_events`, `sequential_numbers`, and `sri_responses` with the same constraints, triggers, and RLS as `public`. **Every future migration that alters a tenant-scoped table must be applied to both schemas.**

**Row-Level Security (RLS):** all issuer-scoped tables (`documents`, `document_line_items`, `document_events`, `sequential_numbers`) have RLS enabled via migration 031. The policy restricts every query to the current issuer by reading `app.current_issuer_id` — a transaction-local PostgreSQL setting. RLS was dropped from `api_keys` in migration 042 because authentication happens before any context can be set; `api_keys` queries filter by `tenant_id` explicitly at the application layer (reintroducing tenant-scoped RLS is noted in `NEXT_STEPS.md`). Two helpers in `src/config/database.js` manage this:
- `db.setIssuerContext(client, issuerId, sandbox)` — call after `BEGIN` on an existing transaction client; sets both `app.current_issuer_id` (for RLS) and `search_path` (`sandbox, public` or `public`), both rolled back automatically on abort.
- `db.queryAsIssuer(issuerId, sql, params, sandbox)` — wraps a single query in a mini BEGIN / set_config / SET LOCAL search_path / query / COMMIT for non-transactional reads.
All authenticated service code paths must use one of these two helpers. Only the Mailgun webhook, admin API, and health check are exempt — they authenticate by other means and operate without an issuer context (the policy's null bypass allows it). The application DB user must **not** be a PostgreSQL superuser; superusers always bypass RLS regardless of policies.

**Notification and webhook system (ADR-015):** tenant-level alerts delivered via webhooks (primary) and polling (fallback). Two creation paths:
- *Event-driven* — `notificationService.createDocumentAuthorized(document, issuer)` is called fire-and-forget from `document-transmission.service.js` when SRI authorises a document. Multiple authorisations within a 60-second window are aggregated into one notification row (same `id`, incrementing `count`). Failure never affects the HTTP response.
- *Scheduled* — `notificationService.runCertChecksForTenant(tenantId, prefs)` checks certificate expiry for all tenant issuers and upserts `CERT_EXPIRING`/`CERT_EXPIRED` alerts. Called by `notification-scheduler.service.runAll()`, which is triggered by `POST /v1/admin/jobs/notifications` (called by external cron). Consumers do NOT call any sync endpoint.
After every notification create/update, `webhookDeliveryService.fanOut(notification)` fans the event out to all active, subscribed webhook endpoints (fire-and-forget). Failed deliveries are retried by the admin job. Consumers can also fall back to `GET /v1/notifications?sinceId=<id>` for catch-up polling.
`notifications`, `notification_preferences`, `webhook_endpoints`, and `webhook_deliveries` tables use `db.query()` directly (not issuer-scoped; no RLS). Optional `X-Issuer-Id` filter on `GET /v1/notifications`: parsed by `parseOptionalIssuerId()` in the controller. When supplied, the query adds `AND (issuer_id = $2 OR issuer_id IS NULL)`. Adding a new notification type requires updating the CHECK constraints in both `044_notifications.sql` (or a new migration) and `045_notification_preferences.sql`, plus entries in `NotificationTypes` and `NotificationSeverity` constants.

**Error monitoring (Sentry):** unexpected `5xx` failures are reported to Sentry via `@sentry/node`. `instrument.js` (project root) calls `Sentry.init({ dsn, environment, sendDefaultPii: false })` and is required at the very top of `app.js` — before any other module — so the SDK can auto-instrument `http`, `express`, and `pg`. `Sentry.setupExpressErrorHandler(app)` is mounted in `server.js` immediately before the central `errorHandler`, so it only reports errors with `statusCode >= 500` (or none) and then forwards unchanged; expected `AppError` 4xx responses (validation, not found, quota, etc.) are never sent. `environment` is always `staging` or `production` (mirrors `config.appEnv`), filterable in the Sentry UI. `SENTRY_DSN` is optional — when unset (e.g. local development), the client is a no-op and nothing is transmitted.

**Config validation:** critical environment variables are validated at startup in `src/config/validate.js` and called from `app.js` before `Server` construction. Always-required: `APP_ENV` (`staging` | `production`), `ENCRYPTION_KEY` (64-char hex format), `ADMIN_SECRET`. Email-required when `EMAIL_PROVIDER` is set to anything other than `'none'`: `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `EMAIL_FROM`. If any are missing or malformed, the process throws immediately with a clear error message before accepting any HTTP requests. This prevents silent failures like unsigned webhooks or unencrypted P12 storage.

---

## Document Lifecycle

All document endpoints require the `X-Issuer-Id` header (the numeric issuer id, returned by `GET /v1/issuers`).

```
POST /v1/documents             → SIGNED   (Idempotency-Key header optional, documentType defaults to '01')
POST /:key/send                 → RECEIVED | RETURNED
GET  /:key/authorize            → AUTHORIZED | NOT_AUTHORIZED  (+fires email)
POST /:key/rebuild              → SIGNED  (from RETURNED or NOT_AUTHORIZED)
GET  /:key/ride                 → application/pdf  (AUTHORIZED only)
GET  /:key/xml                  → application/xml  (authorization XML or signed XML)
GET  /:key/events               → audit trail for the document
POST /email-retry               → batch retry all PENDING/FAILED emails
POST /:key/email-retry          → retry single email (?force=true to resend SENT)
POST /v1/mailgun/webhook       → Mailgun delivery event → update email_status (HMAC-verified)
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
13. Calling `db.query()` directly in an authenticated service or model — use `db.queryAsIssuer(issuerId, sql, params, sandbox)` instead so both RLS and the correct `search_path` are set. `db.query()` (no issuer context) is only correct for the webhook, admin, and health code paths. Exception: even in the webhook path, queries against `documents` or `document_events` must use explicit schema prefixes (`public.documents` / `sandbox.documents`) because the webhook has no issuer context to set `search_path` — see `findByEmailMessageId` for the `UNION ALL` pattern.
14. Adding a migration that alters a tenant-scoped table (`documents`, `document_line_items`, `document_events`, `sequential_numbers`, `sri_responses`) without also applying the same DDL to the `sandbox` schema — the schemas must stay structurally identical.
15. Passing `issuer.environment` directly to `accessKeyService.generate()` or the XML builder — always derive `ambiente` from `config.appEnv` and `issuer.sandbox` first, then build an `effectiveIssuer` with the computed value. Using the raw DB field bypasses the staging safety rail and could embed `ambiente = 2` in a document sent to the test endpoint.
16. Using a plain `new Error()` in any request-path code — the error handler only formats `AppError` subclasses. Plain errors produce unformatted 500 JSON.
17. Throwing `new AppError(message, status)` with a generic HTTP-status code when a more specific code exists — clients need specific codes (`CERTIFICATE_EXPIRED`, `ISSUER_FORBIDDEN`, etc.) to react correctly without parsing `detail` strings. Always import from `src/constants/error-codes.js` and pass the code as the third argument.
18. Adding a new `AppError` throw without adding the code to `src/constants/error-codes.js` first — codes defined inline as string literals are not documented, not discoverable, and can silently diverge across call sites.
19. Adding a new notification type without updating **both** CHECK constraints (`chk_notifications_type` in migration 044 and `chk_notification_preferences_type` in migration 045) — the INSERT will fail at runtime. Also add the type to `src/constants/notification-types.js`.
20. Calling `notificationService.runChecksForTenant()` directly from a tenant request — cert checks are now API-owned and run by the admin scheduler (`POST /v1/admin/jobs/notifications`). No sync endpoint is exposed to tenants. `runCertChecksForTenant` is an exported function for the scheduler, not for controllers.
21. Forgetting to fire `webhookDeliveryService.fanOut(notification)` after creating or updating a notification — all new notification creation paths must fan out to webhook subscribers. The pattern is `if (notification) fireWebhookFanOut(notification)` using the lazy-require helper in `notification.service.js`.
22. Returning the webhook secret in PATCH/list responses — the secret is shown **once only** at registration (in the `POST /v1/webhooks` response). Never include `row.secret` in any other response shape.
23. Relying on a multer instance's `limits.fileSize` to cap one specific field when the same instance handles other fields too — the limit applies to the whole request, not per field (e.g. registration's multer covers both the P12 cert and the logo with one 10 MB ceiling). When a field needs its own stricter cap, check `req.files.<field>[0].size` manually in the controller and throw `AppError` with `INVALID_FILE_UPLOAD`.

---

## Key Files

| File | Purpose |
|------|---------|
| `GETTING_STARTED.md` | Local setup guide |
| `docs/guides/documentation-checklist.md` | **Master reference: what docs to update for each change type** |
| `docs/guides/code-flow.md` | Layer-by-layer request walkthrough |
| `docs/guides/coding-guidelines.md` | Patterns and examples for adding features |
| `docs/adr/` | Architecture Decision Records |
| `instrument.js` | Sentry initialisation — required first in `app.js`, before any other module, so `@sentry/node` can auto-instrument `http`/`express`/`pg` |
| `src/config/validate.js` | Startup config validation — throws if critical env vars are missing or malformed |
| `src/middleware/authenticate.js` | Bearer token → SHA-256 → DB lookup → `req.tenant` + `req.apiKey` + `req.keyHash`; checks suspension. Does NOT set `req.issuer`. |
| `src/middleware/resolve-issuer.js` | Reads `X-Issuer-Id` header → fetches issuer → validates tenant ownership + env match → sets `req.issuer` |
| `src/services/api-key.service.js` | Tenant-facing key management — list, create (named, sandbox/production), revoke |
| `src/routes/api-keys.routes.js` | Mounts `GET / POST / DELETE /v1/keys` for tenants to manage their own keys |
| `src/middleware/authenticate-admin.js` | `ADMIN_SECRET` constant-time check for `/v1/admin/*` |
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
| `src/controllers/mailgun-webhook.controller.js` | Thin handler for `POST /v1/mailgun/webhook` |
| `src/routes/mailgun-webhook.routes.js` | Mounts webhook route with HMAC verification |
| `src/services/email/templates/invoice-authorized.js` | Localised email subject + text + HTML (`render(document, issuer, language)`); strings come from `getTranslations(language).email.invoiceAuthorized` |
| `src/services/ride.service.js` | RIDE PDF generation — on-demand, not persisted |
| `src/services/sri.service.js` | SRI SOAP integration + retry logic |
| `src/services/xml-validator.service.js` | XSD pre-validation via xmllint (async) |
| `src/services/sequential.service.js` | FOR UPDATE sequential locking |
| `src/presenters/document.presenter.js` | `formatDocument()` — shared response shape |
| `src/presenters/notification.presenter.js` | `formatNotification()` — shared notification response shape (used by controller, service, and webhook-delivery service) |
| `src/models/notification.model.js` | Notification CRUD — `create`, `findById`, `findActiveByTenantId` (optional issuer/sinceId filter), `findUnreadCertAlertByIssuer`, `findPendingDocumentAuthorized` (aggregation window), `update`, `updateAggregated`, `markAsRead`, `markAllCertAlertsAsRead`; uses `db.query()` (not issuer-scoped) |
| `src/models/notification-preference.model.js` | Notification preference CRUD — `findByTenantId`, `isEnabled`, `upsertMany`; uses `db.query()` (not issuer-scoped) |
| `src/models/webhook-endpoint.model.js` | Webhook endpoint CRUD — `create`, `findActiveByTenantId`, `countActiveByTenantId`, `findByIdAndTenantId`, `update`, `findSubscribedByTenantIdAndType`; uses `db.query()` (not issuer-scoped) |
| `src/models/webhook-delivery.model.js` | Webhook delivery audit — `create`, `markSuccess`, `markFailure`, `findDueRetries`, `findByNotificationId`; uses `db.query()` (not issuer-scoped) |
| `src/services/notification.service.js` | Notification orchestration — `createDocumentAuthorized` (event-driven, fire-and-forget + webhook fan-out), `runCertChecksForTenant` (called by scheduler), `listForTenant`, `markRead`, `getPreferences`, `updatePreferences` |
| `src/services/webhook-delivery.service.js` | Webhook fan-out and retry — `fanOut(notification)` (fire-and-forget, fans to all subscribed endpoints), `processDueRetries()` (picks up RETRYING rows), HMAC-SHA256 signing |
| `src/services/webhook-endpoint.service.js` | Webhook endpoint CRUD — `create` (tier limit check, secret generation), `list`, `update`, `deregister` |
| `src/services/notification-scheduler.service.js` | Admin job orchestrator — `runAll()` runs cert checks for all non-suspended tenants + webhook retries; called by `POST /v1/admin/jobs/notifications` |
| `src/controllers/notification.controller.js` | Handlers for `GET /v1/notifications` (with optional `?sinceId=`), `POST /v1/notifications/:id/read`, `GET / PATCH /v1/notifications/preferences` |
| `src/controllers/webhook-endpoint.controller.js` | Handlers for `POST / GET / PATCH / DELETE /v1/webhooks` |
| `src/routes/notifications.routes.js` | Notification routes — all authenticated; no sync endpoint |
| `src/routes/webhook-endpoints.routes.js` | Webhook endpoint routes — all authenticated |
| `src/validators/webhook-endpoint.validator.js` | Validators for webhook endpoint create/update |
| `src/constants/notification-types.js` | `NotificationTypes` frozen object — 6 types (3 implemented, 3 reserved) |
| `src/constants/notification-severity.js` | `NotificationSeverity` frozen object — `INFO`, `WARNING`, `ERROR` |
| `src/constants/webhook-delivery-status.js` | `WebhookDeliveryStatus` frozen object — `PENDING`, `SUCCESS`, `RETRYING`, `FAILED` |
| `src/models/tenant.model.js` | Tenant CRUD — `create`, `findByEmail`, `findByVerificationToken`, `activate`, `promote`, `updateTier`, `updateStatus`, `updateVerificationToken`, `updateVerificationEmailSent`, `updateVerificationEmailStatus`, `findByVerificationEmailMessageId`, `countBranchesByTenantId`, `countIssuePointsByBranch` |
| `src/models/tenant-event.model.js` | Tenant event log — `create`, `findByTenantId`; uses `db.query()` (not issuer-scoped) |
| `src/services/certificate.service.js` | P12 parsing — shared by registration and admin service |
| `src/services/registration.service.js` | Self-service registration + resend verification — creates tenant + issuer + sandbox API key; logs tenant events |
| `src/controllers/registration.controller.js` | Handlers for `POST /v1/register`, `POST /v1/resend-verification`, and `GET /v1/verify-email` |
| `src/routes/registration.routes.js` | Public registration, resend-verification, and email verification routes |
| `src/routes/issuers.routes.js` | Authenticated issuer routes: promote, document type list/add/remove, branch creation, logo upload |
| `src/controllers/issuer.controller.js` | Handlers for promote, document type management, and `PATCH /v1/issuers/:id/logo` |
| `src/services/issuer.service.js` | `listDocumentTypes`, `addDocumentType`, `removeDocumentType` — validates against `SUPPORTED_TYPES` |
| `src/models/issuer-document-type.model.js` | `bulkCreate`, `findActiveByIssuerId`, `activate`, `deactivate` — uses `db.query()` (not issuer-scoped) |
| `src/constants/subscription-tiers.js` | Tier definitions: `documentQuota`, `maxBranches`, `maxIssuePointsPerBranch`, rate limits |
| `src/constants/tenant-status.js` | `TenantStatus` frozen object — `PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED` |
| `src/constants/email-status.js` | `EmailStatus` frozen object — `PENDING`, `SENT`, `FAILED`, `DELIVERED`, `COMPLAINED`, `SKIPPED` — shared by document and tenant email tracking |
| `src/constants/error-codes.js` | **Single source of truth for all stable `code` values** in RFC 7807 error responses. Import from here at every throw site — never hard-code code strings inline. Full catalogue documented in `docs/site/errors/index.md`. |
| `src/locales/index.js` | `getTranslations(lang)` + `SUPPORTED_LANGUAGES` + `DEFAULT_LANGUAGE` — single source of truth for i18n |
| `src/locales/en.js` / `src/locales/es.js` | Locale string objects keyed by domain (`email.verifyEmail.*`) |
| `src/services/tenant.service.js` | Tenant mutations — `updateLanguage`, `promote` (with ACTIVE status check) |
| `src/controllers/tenant.controller.js` | Thin handlers for `GET /v1/tenants/me`, `PATCH /v1/tenants/language`, and `POST /v1/tenants/promote` |
| `src/routes/tenants.routes.js` | Authenticated tenant routes: get current tenant, language update, promotion |
| `src/services/admin.service.js` | Tenant + issuer + API key management |
| `src/controllers/admin.controller.js` | Thin HTTP handlers for admin routes |
| `src/routes/admin.routes.js` | `/v1/admin/*` — admin auth + rate limit, tenant/issuer/key CRUD |
| `src/models/api-key.model.js` | Tenant-scoped key CRUD — `findByKeyHash` (joins tenants), `create({ tenantId, ... })`, `findActiveByTenantId`, `findByIdAndTenantId`, `revoke`, `revokeAllByTenantIdAndEnvironment` |
| `src/errors/conflict-error.js` | AppError subclass for HTTP 409 |
| `src/errors/quota-exceeded-error.js` | AppError subclass for HTTP 402 QUOTA_EXCEEDED |
| `src/builders/index.js` | Builder registry |
| `helpers/ride-builder.js` | PDFKit A4 RIDE renderer (Code 128 barcode via bwip-js; renders `issuer.logo` in the top-left header when present) |
| `src/constants/document-state-machine.js` | `TRANSITIONS` map + `canTransition` / `assertTransition` |
| `src/config/database.js` | pg Pool + `query` (bypass) + `setIssuerContext(client, issuerId, sandbox)` + `queryAsIssuer(issuerId, sql, params, sandbox)` — sets both RLS context and `search_path` |
| `db/migrations/` | SQL migration files 001–050 (031: RLS; 033: sandbox schema; 034: api_key environment; 042: api_keys tenant-scoped; 043: sandbox moved from issuers to tenants; 044–047: notifications + webhooks; 048: term unit catalog; 049: drop issuer environment; 050: issuer logo) |
| `assets/factura_V2.1.0.xsd` | Official SRI invoice schema |
| `.example.env` | Environment variable template |
