# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- **`DELETE /v1/subscriptions`** — tenants can now schedule a cancellation at the end of the current billing period. No refund is issued; the subscription keeps running at the current tier until `current_period_end`, then the tenant drops to FREE and the subscription is closed (`CANCELLED`). Setting `pending_tier = 'FREE'` reuses the existing scheduled-downgrade infrastructure (`applyScheduledTierChanges`, daily admin job) — no new job needed. New error code: `CANCELLATION_ALREADY_PENDING`.
- **Recurring subscription renewals** — `subscriptions.current_period_end` is now a real recurring billing date: `subscriptionService.processDueRenewals()` (called by `POST /v1/admin/jobs/subscriptions`, after `applyScheduledTierChanges()`) opens a `RENEWAL` payment + reminder ~7 days before it's due, and downgrades an unpaid subscription to FREE ~7 days after if no renewal ever completes. Renewal payments ride the exact same proof-upload/admin-review/link-invoice pipeline as the initial subscription. Period math (`addBillingPeriod`) is now anchored to the old period end everywhere a period extends, never to "now," so an early or late admin review can't drift the billing date; a downgrade also rolls its period forward for free so it re-enters the renewal cycle at its new tier instead of being mistaken for an expired one.
- **Payment review and renewal notifications/emails** — `reviewPayment()`'s `VERIFIED`/`REJECTED` decision now fires a tenant-facing notification (new `PAYMENT_VERIFIED`/`PAYMENT_REJECTED` types, fanned out to webhooks) and email, covering every payment purpose (initial subscription, tier change, renewal) uniformly. The renewal reminder and the eventual expiry-to-FREE each fire their own notification (`SUBSCRIPTION_RENEWAL_DUE`, `SUBSCRIPTION_EXPIRED`) and email — a tenant should never be silently downgraded. Separately, `submitPaymentProof()` now emails the operator (`ADMIN_NOTIFICATION_EMAIL`, optional — skipped if unset) so there's a signal that a proof is waiting for review, instead of relying on the operator to remember to check.
- **`POST /v1/subscriptions`** — lets a tenant start a paid subscription on its own, independent of promotion. Works while still in sandbox (so a tenant can pay before going to production) or any time after, requiring only a verified email (same gate `POST /v1/tenants/promote` already used). `POST /v1/tenants/promote` now checks for an already-`ACTIVE` subscription before honoring its own optional `tier`/`billingInterval` fields — if one exists (e.g. started via this new endpoint), tier selection is skipped entirely and the response surfaces the existing subscription instead of starting a new one.
- **Subscription + payment pipeline** — new `subscriptions`/`payments` tables track a tenant's paid-tier billing while no payment gateway exists. A subscription only reaches `ACTIVE` once its linked invoice document is SRI-`AUTHORIZED`, never merely on payment. Tier selection happens at `POST /v1/tenants/promote` (new optional `tier`/`billingInterval` fields) — promotion itself never waits on payment. The tenant uploads proof of the SPI transfer themselves via `PATCH /v1/payments/:id/proof` (new, multipart, their own API key); the operator reviews it (`GET /v1/admin/payments/:id/proof`) and decides with one endpoint, `PATCH /v1/admin/payments/:id/review` (`{ decision: "VERIFIED" | "REJECTED", rejectionReason }` — `rejectionReason` required when rejecting), then links the self-billed invoice (`PATCH /v1/admin/subscriptions/:id/link-invoice`). A rejected payment can be re-submitted with new proof (only `VERIFIED` blocks further uploads). `document-transmission.service.js` fires `subscriptionService.activateIfLinked()` fire-and-forget on every document authorization (no-op unless that document is a subscription's linked invoice).
- **`GET /v1/subscriptions/me`** — tenant-facing, returns the full subscription/payment history (with `rejection_reason` when applicable) since there's no notification when a review or activation completes.
- **Yearly billing** — `priceYearlyUsd` (2 months free vs. monthly) added for Starter/Growth/Business. New public `GET /v1/tiers` (no auth) exposes the full tier catalog — quota, both prices, overage rate, limits — for a pricing page.
- **`PATCH /v1/admin/tenants/:id/tier`** (the direct admin tier override) now logs a `TIER_CHANGED` tenant event — previously silent.
- **Document type tier gating** — `POST /v1/issuers/:id/document-types` and the `documentTypes` field on `POST /v1/issuers` now reject activating a type not included in the tenant's plan (402 `DOCUMENT_TYPE_NOT_IN_TIER`). Free/Starter are limited to facturas (`01`); Growth/Business also get credit notes (`04`). Downgrading is grandfathered — already-active types on existing issuers keep working; only activating *new* gated types is blocked.
- **`POST /v1/subscriptions/change-tier`** — lets a tenant with an `ACTIVE` subscription upgrade or downgrade tier. No payment gateway exists, so this rides the same manual proof/review pipeline as the initial subscription. Upgrades take effect immediately, gated on a prorated payment (the price difference scaled by the remaining time in the current billing period) — uploaded via the same `PATCH /v1/payments/:id/proof`, reviewed and invoice-linked the same way, applied on invoice authorization (or immediately, with no payment step, if the prorated amount rounds to $0). Downgrades are scheduled with no payment owed — the current period is already paid for at the higher tier — and applied at `current_period_end` by a new admin job, `POST /v1/admin/jobs/subscriptions` (same external-cron pattern as the notification job, daily cadence is enough). New error codes: `NO_ACTIVE_SUBSCRIPTION`, `TIER_CHANGE_NO_OP`, `TIER_CHANGE_ALREADY_PENDING`.

### Changed
- **FREE tier document quota reduced from 100 to 5 documents/month** — the prior limit let a real freelancer or small business run indefinitely without ever needing to upgrade.
- **Document quota no longer counts sandbox documents** — `tenants.document_count` only increments for production document creation, so testing against SRI pruebas never consumes a tenant's plan quota.
- **Starter/Growth/Business document quotas cut to 200/1,000/4,000 (from 1,000/5,000/20,000)** — the old figures granted far more volume than any published competitor tier in the Ecuadorian/regional market (Datil's cheapest tier caps at 12/month; NubeFact's flagship plan caps at 500/month). Overage rates raised in tandem (Starter $0.04→$0.30, Growth $0.025→$0.15, Business $0.015→$0.08/invoice).
- **`priceMonthlyUsd` / `overagePerDocumentUsd` added to `src/constants/subscription-tiers.js`** — pricing now has one source of truth alongside the limits it's priced against, instead of living only in a planning doc. Not billed or enforced anywhere yet — no payment gateway is wired up (see `NEXT_STEPS.md` #9).
- **Removed `STRATEGY.md`** — its pricing model is superseded by the constants above; its competitive analysis, payments-in-Ecuador findings, and roadmap had served their purpose for the planning phase now that the project is moving into execution.

## [0.6.0] — 2026-06-27

### Added
- **`PATCH /v1/issuers/:id/activate`** — reactivates a soft-deleted issuer. Re-runs the same branch/issue-point plan-limit checks as `POST /v1/issuers` (`BRANCH_LIMIT_REACHED` / `ISSUE_POINT_LIMIT_REACHED`, 402) so deactivate-then-reactivate can't be used to exceed a tenant's plan caps.
- **`PATCH /v1/issuers/:id`** — edit `tradeName` and/or `branchAddress` for an existing issuer (at least one required). Does not accept `businessName`/`mainAddress`/`ruc` — those stay permanently tied to the RUC registration.
- **`DELETE /v1/issuers/:id`** — soft-deletes an issuer (`active = false`). Rejects with `LAST_ISSUER_CANNOT_BE_REMOVED` (400) if it's the tenant's only remaining issuer, or `ISSUER_HAS_DOCUMENTS` (400) if it has ever issued a document (checked in both the `public` and `sandbox` schemas).
- **`GET /v1/issuers/:id/sequentials`** — returns the current and next sequential number per active document type, broken out by `sandbox`/`production` environment, so the UI can show what a manual edit would set without requiring callers to do the `current + 1` math.
- **`PATCH /v1/issuers/:id/sequentials/:documentType`** — manually sets the next sequential number for one document type in one environment (`{ environment, nextSequential }`). Locks the counter row with `SELECT ... FOR UPDATE` inside the same transaction as the write, so it can't race against a concurrent `POST /v1/documents` and produce a duplicate sequential. Rejects with `SEQUENTIAL_CANNOT_DECREASE` (400) if `nextSequential` doesn't exceed the current value.
- **`GET /v1/documents/:accessKey/credit-notes`** — returns the sum of all `AUTHORIZED` credit notes already issued against a document plus the remaining balance, so callers can guard against over-crediting an invoice. Reconstructs the document's own `NNN-NNN-NNNNNNNNN` number and matches credit notes by `request_payload->'originalDocument'` (there's no FK linking them). Document-type-agnostic on the original side — doesn't assume `01`.
- **Nota de Crédito (document type `04`)** — `POST /v1/documents` now accepts credit notes referencing an original invoice (`originalDocument.documentType`/`number`/`issueDate`) plus a `motivo`. New `CreditNoteBuilder`, dedicated validator (no `payments` block; see `src/middleware/select-document-validator.js` for per-type validator dispatch), schema-aware XSD validation (`assets/nota_credito_V1.1.0.xsd`), and document-type-aware RIDE PDF (header label + a "Documento que se modifica" section in place of "Forma de pago") and authorization email subject/labels.
- **`PATCH /v1/issuers/:id/certificate`** — renews the P12 certificate (private key + X.509 cert) stored for an existing issuer, e.g. when it has expired. Reuses `certificateService.parseCertificate` + `cryptoService.encrypt` from issuer creation; updates only the targeted issuer row (sibling branches that inherited the cert via `sourceIssuerId` are unaffected). Does not touch already-signed documents — each signed invoice embeds its own certificate copy inside the XML signature. Admin override at `PATCH /v1/admin/issuers/:id/certificate` (no tenant ownership check).
- **`GET /v1/documents/stats`** — per-document-type breakdown (`issued` count + `authorizedTotal`) for the current calendar month, plus an all-time `needsAttention` count (`RETURNED` + `NOT_AUTHORIZED`). Powers the comprobify-web dashboard's revenue summary.
- **`GET /v1/tenants/me`** — resolves the tenant owning the authenticated API key (`id`, `email`, `subscriptionTier`, `status`, `documentCount`, `documentQuota`, `sandbox`). No DB lookup — echoes what `authenticate` middleware already resolved from the key. Lets a third-party app that only holds an API key (no RUC/P12 on hand) discover its numeric `tenant.id`, e.g. to link an existing account or correlate webhook deliveries.

### Changed
- **`GET /v1/documents` supports sorting and two new filters** — `sortBy` (`sequential`, `buyerName`, `issueDate`, `status`) + `sortDir` (`asc`/`desc`, defaults to `desc`) sort the list via a column whitelist; omitting `sortBy` keeps the existing `created_at DESC` default, so no behavior change for existing callers. New `buyerName` query param filters with a case-insensitive contains match (`ILIKE`). New `sequential` query param filters with a case-insensitive contains match against the zero-padded 9-digit value (`LPAD(sequential::text, 9, '0') ILIKE ...`) — `sequential` is an `INTEGER` column, so `ILIKE` can't apply directly, and the padding also matches the 9-digit format already shown in API responses. Both combine with `AND` like the existing filters. Also fixed `documentType` validation, which only accepted `01` — it now accepts all supported codes (`01`, `03`, `04`, `05`, `06`, `07`).

### Fixed
- **`POST /v1/issuers` rejected valid `documentTypes`/`initialSequentials` sent as `multipart/form-data`** — the request is multipart (it also carries the optional P12 `cert` file), and multipart fields never auto-deserialize a JSON string into an array, so a JSON-encoded array string for either field always failed `isArray()` validation. `registration.validator.js` already solved this for the identical fields on `POST /v1/register` via a `customSanitizer` that JSON-parses string values before the array check; `issuer.validator.js`'s `createBranch` now applies the same sanitizer.
- **Email retry could resend a `DELIVERED` or `COMPLAINED` email without `?force=true`** — the guard in `retrySingleEmail` only checked for `email_status === SENT`. Now blocks retry on any terminal success status (`SENT`, `DELIVERED`, `COMPLAINED`) unless `force=true` is explicitly passed.
- **Logo upload at registration could exceed 500 KB** — `POST /v1/register`'s multer instance enforces a single 10 MB whole-request limit (shared with the P12 cert field), so it could not cap the logo field individually. `registration.controller.js` now checks the logo file's size directly and throws `INVALID_FILE_UPLOAD` (400) if it exceeds 500 KB, matching the limit already enforced by `PATCH /v1/issuers/:id/logo`.

### Added
- **Issuer logo on RIDE PDFs** — issuers can now upload a company logo that renders in the top-left corner of every RIDE PDF (including email attachments). Logo is stored as `BYTEA` in `issuers.logo` (migration 050, replaces the unused `logo_path` column). Two ways to set it:
  - `POST /v1/register` — optional `logo` file field (PNG, JPEG, or GIF; max 500 KB) in the registration `multipart/form-data` request.
  - `PATCH /v1/issuers/:id/logo` — new authenticated endpoint to upload or replace the logo for an existing issuer.

### Fixed
- **RIDE PDF "Forma de pago" section missing bottom border** — the last payment row had no closing line. The outer `strokeBox` only provided the overall section border; individual rows drew an `hline` at their top but not their bottom. A closing `hline` is now drawn after the last payment row.
- **Rebuild silently dropped a corrected `buyer_email` and left stale line items** — `buyer_email` was missing from `MUTABLE_EXTRA_COLUMNS` in `document.model.js` and was never passed to `updateStatus`, so a corrected buyer email on `POST /:key/rebuild` was ignored. Separately, line items (including tax `rateCode` changes) were never deleted and re-inserted on rebuild, leaving the original rows in `document_line_items` unchanged alongside the new signed XML. Both fixes are now wrapped in a single transaction (`document-rebuild.service.js`) so the document update, line-item replacement (`documentLineItemModel.deleteByDocumentId` + `bulkCreate`), and `REBUILT` audit event are atomic.
- **Bypass-mode writes on tenant-scoped tables could violate RLS if the issuer context was omitted** — `documentModel.updateStatus`, `documentLineItemModel.bulkCreate`, and `documentEventModel.create` now explicitly qualify the `sandbox`/`public` schema prefix in their `db.query()` (no client, no issuerId) bypass path, so a caller that omits the issuer context can no longer produce an RLS violation.
- **Mailgun webhook events for sandbox documents never updated `email_status`** — `findByEmailMessageId` queried `public.documents` only, so sandbox documents (created while `tenant.sandbox = true`) never transitioned from `SENT` to `DELIVERED`/`FAILED`/`COMPLAINED`. The query now `UNION ALL`s across `public.documents` and `sandbox.documents`, returns a `sandbox` boolean on the result row, and threads it through to both `updateEmailStatus` and `documentEventModel.create` so the update and audit event land in the correct schema. See ADR-010.
- **Mailgun webhook audit events violated RLS** — `documentEventModel.create` calls in the webhook path passed `issuerId = null`, routing through the no-context `db.query()` bypass, which the `document_events` RLS policy rejects for `INSERT`. `document.issuer_id` (available from the `findByEmailMessageId` result) is now passed through, routing the insert via `db.queryAsIssuer` so the RLS context is set correctly.

### Changed (BREAKING)
- **Route prefix changed from `/api` to `/v1`** — all endpoints are now served under `/v1/` (e.g. `POST /v1/documents`). Update all client `base_url` values. Base URL: `https://api.comprobify.com/v1`.
- **Docs migrated to Cloudflare Pages** — public API documentation is now at `https://docs.comprobify.com` (previously `https://novaej.github.io/comprobify`). The RFC 7807 `type` URL in all error responses now points to the new domain when `DOCS_BASE_URL` is set.

### Added
- **Payment term unit catalog** (`GET /v1/catalogs/term-units`) — returns the SRI-accepted values for `unidadTiempo` (`dias`, `meses`; `cat_term_units` table, migration 048) so clients can discover and validate `payments[].termUnit` before sending invoices *a plazos* (e.g. `{ method, total, term: 12, termUnit: 'meses' }` → `<plazo>12</plazo><unidadTiempo>meses</unidadTiempo>`). `payments[].termUnit` is now validated against this catalog in `invoice.validator.js`, mirroring the existing `payments[].method` check.

### Fixed
- **RIDE PDF dropped the installment term** — the "Forma de pago" section showed only the payment method and amount, omitting `plazo`/`unidadTiempo` for invoices *a plazos*. `ride.service.js` now resolves a human-readable `termUnitLabel` via the new `cat_term_units` catalog, and `helpers/ride-builder.js` appends `(N UNIT)` to the payment row label when a term is present, e.g. `20 - TARJETA DE CRÉDITO (12 MESES)`.

### Changed
- **Invoice-authorized email is now localised** — `src/services/email/templates/invoice-authorized.js` now renders subject/text/HTML from `getTranslations(language).email.invoiceAuthorized` (new `en`/`es` string blocks in `src/locales/`) instead of hardcoded Spanish strings, mirroring the existing `verify-email.js` pattern. `email.service.js` resolves the language from the **issuer's tenant** `preferred_language` (via `issuer.tenant_id` → `tenantModel.findById`), falling back to `'es'` — there is no buyer-language field, so the issuer's tenant preference is used as the closest available signal.

### Added
- **Sentry error monitoring** — unexpected `5xx` failures are now reported to [Sentry](https://sentry.io) via `@sentry/node`. `instrument.js` initialises the SDK before any other module loads (required first in `app.js` for auto-instrumentation of `http`/`express`/`pg`); `Sentry.setupExpressErrorHandler()` is mounted in `server.js` directly before the central `errorHandler`, so only genuine internal errors (`statusCode >= 500`) are reported — expected `AppError` 4xx responses (validation, not found, quota, etc.) are not. Events are tagged with `environment` (`staging` / `production`, mirroring `APP_ENV`) so they can be filtered in the Sentry UI. Configured via the optional `SENTRY_DSN` env var — when unset, the client is a no-op (e.g. local development sends nothing).
- **Notification system** (`GET / POST /v1/notifications`, `POST /v1/notifications/sync`, `POST /v1/notifications/:id/read`, `GET / PATCH /v1/notifications/preferences`). Tenant-level alerts for two initial conditions:
  - `DOCUMENT_AUTHORIZED` — created automatically (fire-and-forget) when SRI authorises a document. Multiple authorisations within a 60-second window are aggregated into a single notification row to prevent batch flooding. The notification `id` is stable across polls; the frontend should upsert by `id`.
  - `CERT_EXPIRING` / `CERT_EXPIRED` — upserted by `POST /v1/notifications/sync`, which the frontend backend calls on a schedule. At most one unread alert per issuer; auto-dismissed when the certificate is renewed. Severity escalates from `WARNING` (> 7 days) to `ERROR` (≤ 7 days), then transitions to `CERT_EXPIRED` when the `notAfter` date passes.
  - Optional `X-Issuer-Id` filter on list and sync endpoints: when supplied, returns only that issuer's notifications plus tenant-level ones (`issuerId: null`).
  - Per-tenant opt-out preferences (`notification_preferences` table, migration 045). All types default to enabled. `PATCH /v1/notifications/preferences` accepts an array of `{ type, enabled }` objects.
  - `notifications` table (migration 044) with `id`, `tenant_id`, `issuer_id` (nullable), `type`, `severity`, `title`, `message`, `metadata` (JSONB), `read_at`, `expires_at`, `created_at`. CHECK constraints on `type` and `severity`.
  - See [ADR-015](docs/adr/015-notifications.md) for design rationale (polling model, aggregation, issuer filter, frontend-managed per-user read state).

### Fixed
- **Certificate expiry at signing time returned 500** — `helpers/signer.js` threw a plain `Error` when a certificate had expired after registration. Now throws `AppError` with code `CERTIFICATE_EXPIRED` (400), matching the check already present in `certificate.service.js` at upload time.
- **`registration.controller.js` swapped `AppError` constructor arguments** — `AppError(403, 'message')` was called with status code and message reversed, causing malformed error responses for suspended account attempts during re-registration. Fixed by removing the try/catch entirely.
- **`verifyEmail` response bypassed the error handler** — the controller constructed the RFC 7807 JSON manually and sent it directly, missing `Content-Type: application/problem+json`. Now throws `AppError` and lets the central error handler format the response.
- **`crypto.service.js` and `builders/index.js` threw plain `Error`** — two guard checks produced unformatted 500 responses. Both now throw `AppError` with specific codes (`DECRYPTION_FAILED`, `BUILDER_NOT_FOUND`).

### Changed
- **Specific `code` values on all operational errors** — previously most errors fell back to the HTTP-status default code (`BAD_REQUEST`, `FORBIDDEN`, etc.). Every operationally distinct error now carries a specific code from the new `src/constants/error-codes.js` catalogue (e.g. `CERTIFICATE_EXPIRED`, `ISSUER_FORBIDDEN`, `EMAIL_VERIFICATION_REQUIRED`, `RESEND_COOLDOWN`, `API_KEY_ENV_MISMATCH`). Clients should switch on `code`, not `status` or `detail`. Existing `VALIDATION_FAILED`, `SRI_SUBMISSION_FAILED`, and `QUOTA_EXCEEDED` codes are unchanged.
- **`AppError` constructor accepts optional `code` parameter** — third positional argument overrides the HTTP-status-derived default. `isOperational` moves to fourth. No existing call sites are affected.
- **`registration.service.js` sentinel string errors replaced** — `throw new Error('SUSPENDED')`, `'RESEND_COOLDOWN'`, `'ALREADY_VERIFIED'`, `'INVALID_TOKEN'` replaced with proper `AppError` / `ConflictError` throws. The corresponding try/catch blocks in `registration.controller.js` are removed; the controller now relies on `asyncHandler` alone as intended by CLAUDE.md.
- **Error messages made more actionable** — certificate errors now include the expiry date; tier-limit errors name the plan and the limit; RUC mismatch shows both values; environment mismatch names both environments.

### Changed (BREAKING)
- **Promotion is now tenant-level** (ADR-014). `POST /v1/issuers/:id/promote` is removed. Use `POST /v1/tenants/promote` instead. The new endpoint promotes all branches at once, revokes all active sandbox API keys, and returns matching production keys (one per revoked sandbox key, same label). Admin override: `POST /v1/admin/tenants/:id/promote`. The `initialSequentials` parameter now takes `[{ issuerId, documentType, sequential }]` to allow per-branch per-type overrides.
- **`issuers.sandbox` column removed** (migration 043). `tenants.sandbox` (boolean, default `true`) is now the single source of truth for environment. All issuer responses no longer include a `sandbox` field — the environment applies to the whole tenant.
- **`POST /v1/admin/issuers/:id/promote` removed** — replaced by `POST /v1/admin/tenants/:id/promote`.

### Changed (BREAKING)
- **API keys are now tenant-scoped, not issuer-scoped** (ADR-013). Migration 042 moves `api_keys.issuer_id` → `tenant_id` and drops the issuer-scoped RLS policy. Every authenticated document endpoint now requires an `X-Issuer-Id` header naming the target branch. Missing header → `400 BAD_REQUEST`; foreign issuer → `403 FORBIDDEN`; env mismatch → `401`. `authenticate` middleware now sets `req.tenant` + `req.apiKey` + `req.keyHash` (no longer `req.issuer`); a new `resolveIssuer` middleware mounted on `/v1/documents/*` sets `req.issuer` from the header. Issuer-management endpoints moved from implicit-key targeting to explicit URL params: `POST /v1/issuers/promote` → `POST /v1/issuers/:id/promote`, `GET/POST/DELETE /v1/issuers/document-types*` → `GET/POST/DELETE /v1/issuers/:id/document-types*`, `GET /v1/issuers/me` → `GET /v1/issuers/:id`. Admin key creation moved from `POST /v1/admin/issuers/:id/api-keys` → `POST /v1/admin/tenants/:id/api-keys`. `POST /v1/issuers` (create branch) no longer mints a key — the tenant's existing key already covers every branch.

### Added
- **`GET / POST / DELETE /v1/keys`** — tenant-facing API key management. Mint multiple named keys (e.g. `frontend-prod`, `erp`, `mobile-app`), list them, and revoke leaked ones. `POST /v1/keys` accepts `label` and optional `environment` (`sandbox` | `production`); production keys require at least one promoted issuer. `DELETE /v1/keys/:id` cannot revoke the key being used for the request.
- **`X-Issuer-Id` request header** documented in [ADR-013](docs/adr/013-tenant-scoped-api-keys.md) and surfaced in every endpoint reference page.
- **`FORBIDDEN` error code** (403) — distinct from `UNAUTHORIZED`. Surfaced when the API key is valid but the target resource belongs to a different tenant, or when the tenant is unverified / suspended.
- **`POST /v1/issuers`** — self-service branch/issue-point creation. Authenticated endpoint that creates a new issuer row sharing the tenant's RUC and certificate. Inherits all issuer-level fields (RUC, business name, cert) from another of the tenant's issuers (named by `sourceIssuerId`, or the first existing one by default); only `branchCode` and `issuePointCode` are required. An optional P12 upload overrides the certificate for branches that use a different cert. Tier limits (`maxBranches`, `maxIssuePointsPerBranch`) are enforced and return 402 when exceeded.

### Changed
- **`requestPayload` added to document responses** — all endpoints that return a document object now include `requestPayload` (the original request body). Omitted when `null`. Intended for pre-filling the Rebuild Invoice form after a rejection.

### Added
- **`verificationRedirectUrl` on `POST /v1/register`** — optional field that stores a frontend URL on the tenant row. Verification emails will link to `${verificationRedirectUrl}?token=<token>` instead of directly to the API, enabling frontend-integrated verification flows. Validated as a URL; `https` required in production, `http` accepted in staging.
- **`APP_BASE_URL` env var** — now required and validated at startup; used as the base for verification email links when no per-tenant `verificationRedirectUrl` is set. Previously the config key existed but was not validated at startup, so a missing value produced broken links silently.
- **`VERIFICATION_TOKEN_TTL_HOURS` env var** — configures the verification token lifetime (default 24 hours). Previously hardcoded.
- **Per-account resend cooldown** — `POST /v1/resend-verification` now enforces a 60-second server-side cooldown per email address, checked against `tenants.verification_email_sent_at`. Returns `429 TOO_MANY_REQUESTS` if the cooldown has not elapsed. Frontend-side cooldowns were already in place but were bypassable via direct API calls.
- `verification_redirect_url` and `verification_email_sent_at` columns added to `tenants` (migration 039).
- **Email localisation (`src/locales/`)** — cross-cutting locale layer shared by email templates and (in future) API responses. `getTranslations(lang)` returns locale strings with `'es'` fallback. `SUPPORTED_LANGUAGES` is the single source of truth for accepted language codes.
- **`language` field on `POST /v1/register`** — optional, accepted values `es` | `en` (default `es`). Stored as `preferred_language` on the tenant and used for all outgoing emails for that tenant.
- **`PATCH /v1/tenants/language`** — new authenticated endpoint to update `preferred_language` after registration.
- `preferred_language VARCHAR(5) NOT NULL DEFAULT 'es'` added to `tenants` (migration 040).
- **Issuer document types** — `issuer_document_types` table (migration 038) records which SRI document types each issuer is permitted to use. Defaults to `['01']` (invoice) if not specified at registration or admin create. Document creation now validates the requested type against this list and returns 400 if not allowed.
- **`GET /v1/issuers/document-types`** — list active document types for the authenticated issuer.
- **`POST /v1/issuers/document-types`** — enable a document type for the issuer (validates against supported builder types).
- **`DELETE /v1/issuers/document-types/:code`** — disable a document type; prevents removing the last active type.
- **`initialSequentials` on promote** — both `POST /v1/issuers/promote` and `POST /v1/admin/issuers/:id/promote` now accept an optional `initialSequentials` array (`[{ documentType, sequential }]`). All active document types have their production sequentials seeded at promotion time — using the supplied value if present, or 1 if not.
- `documentTypes` field on `POST /v1/register` and `POST /v1/admin/issuers` — optional array of document type codes to enable for the new issuer (default `['01']`). Sequentials are initialized for each type at creation time.
- `SUPPORTED_TYPES` exported from `src/builders/index.js` — derived from the builder registry, used by validators and the issuer service to check type eligibility.
- **`POST /v1/resend-verification`** — public endpoint to resend the verification email. Regenerates the token with a new 24-hour expiry (invalidating the previous one). Returns a generic message to avoid email enumeration. Rate-limited via the existing `registrationLimiter`. Returns 409 if already verified, 403 if suspended.
- **Tenant event log** — new `tenant_events` table (migration 036) records lifecycle events for tenants: `VERIFICATION_EMAIL_SENT`, `VERIFICATION_EMAIL_FAILED`, `EMAIL_VERIFIED`, `VERIFICATION_EMAIL_DELIVERED`, `VERIFICATION_EMAIL_TEMP_FAILED`, `VERIFICATION_EMAIL_COMPLAINED`.
- **Verification email delivery tracking** — `verification_email_message_id` and `verification_email_status` columns added to `tenants` (migration 037). Mailgun webhook now falls through to a tenant lookup when no document matches the message ID, updating these fields and writing `tenant_events` rows on delivery/failure/complaint — the same lifecycle as invoice emails.
- `email.service.sendVerificationEmail()` now returns `{ messageId }` so the Mailgun message ID can be stored on the tenant row after a successful send.

### Changed
- **`document_count` / `document_quota` replace `invoice_count` / `invoice_quota` on `tenants`** — the quota tracks all document types, not just invoices. Migration 041 renames the columns; `documentCount` and `documentQuota` are the new field names in API responses.
- **Branch and issue point limits replace `maxIssuers`** — subscription tiers now enforce separate limits: `maxBranches` (max distinct branches per tenant) and `maxIssuePointsPerBranch` (max issuing points per branch). Tier defaults: FREE 1/1, STARTER 3/2, GROWTH 10/5, BUSINESS unlimited.
- **Tenant and email status strings centralised into constants** — `src/constants/tenant-status.js` (`TenantStatus`) and `src/constants/email-status.js` (`EmailStatus`) replace hardcoded string literals across all services, models, middleware, controllers, validators, and presenters. No behaviour change.
- **`POST /v1/register` is now idempotent** — if the email already exists and the account is not suspended, the endpoint revokes the current sandbox API key, issues a new one, and returns `200` with the same response shape as initial registration (`tenant`, `issuer`, `apiKey`). Allows frontend clients to self-heal if the API key was lost after a successful registration call. Returns `403` if the account is suspended (previously would 409).
- All primary key columns (`id`) and their referencing foreign key columns migrated from `INT` (`SERIAL`) to `BIGINT` (`BIGSERIAL`) across all tables — migration 030. Sequences updated to `BIGINT` maxvalue. No application code changes required.

### Added
- **Sandbox environment + SRI endpoint routing** — `APP_ENV` env var (`staging` | `production`) combined with a per-issuer `sandbox` boolean controls which SRI endpoint is used. Staging always hits the SRI test endpoint regardless of the issuer flag; production uses the SRI production endpoint only for issuers that have been explicitly promoted (`sandbox = false`). The effective `ambiente` value (`1` = pruebas, `2` = producción) is derived from the same logic and embedded in both the 49-digit access key and the XML `infoTributaria/ambiente` field. Migrations 032 (adds `sandbox BOOLEAN NOT NULL DEFAULT true` to `issuers`) and 033 (creates the `sandbox` PostgreSQL schema) implement this. All existing issuers default to `sandbox = true` (safe mode) on upgrade. The `sandbox` field is exposed on `POST /v1/admin/issuers` and `GET /v1/admin/issuers`.
- **Sandbox PostgreSQL schema** — sandbox and production documents live in separate schemas (`sandbox` vs `public`) so sequential number sequences are fully independent, test data can be truncated without touching production records, and production queries on `public` never surface test invoices. The `sandbox` schema contains `documents`, `document_line_items`, `document_events`, `sequential_numbers`, and `sri_responses`, each with the same constraints, triggers, and RLS policies as their `public` counterparts. The DB layer sets `SET LOCAL search_path TO sandbox, public` (or `public`) per transaction based on `issuer.sandbox`, so unqualified table names resolve to the correct schema transparently.
- **PostgreSQL Row-Level Security (RLS)** — tenant isolation enforced at the database level in addition to the application layer. Migration 031 enables RLS + `FORCE ROW LEVEL SECURITY` on `documents`, `document_line_items`, `document_events`, `sequential_numbers`, and `api_keys`. Each policy restricts access to rows whose `issuer_id` matches `app.current_issuer_id`, a transaction-local setting injected by the new `db.setIssuerContext()` / `db.queryAsIssuer()` helpers in `src/config/database.js`. All authenticated code paths now set this context before any DB query, so a bug that omits a `WHERE issuer_id = $1` clause cannot expose another tenant's data. Webhook, admin, and health code paths — which authenticate by other means — operate without setting the context and are explicitly allowed by the policy's null bypass. **Prerequisite:** the application database user must not be a PostgreSQL superuser (superusers always bypass RLS).
- **Health endpoint** — `GET /health` checks database connectivity and returns `{ status: "ok", uptime }` (200) or `{ status: "error", uptime }` (503). No authentication required. Suitable for load balancer health checks, uptime monitors, and container liveness probes.
- **Startup config validation** — critical environment variables (`ENCRYPTION_KEY`, `ADMIN_SECRET`, and conditional email vars) are validated on startup before the server accepts any requests. Missing or malformed config throws immediately with a clear error message (e.g., `Missing required environment variable(s): ENCRYPTION_KEY, ADMIN_SECRET`). See `src/config/validate.js`. Email vars can be opted out by setting `EMAIL_PROVIDER=none`.
- **Per-API-key rate limiting** — all authenticated endpoints are rate-limited to prevent abuse and quota exhaustion. Write endpoints (POST) limited to 60 requests/minute; read endpoints (GET) to 300 requests/minute per API key. Limits are configurable via `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX` environment variables. Exceeded limits return `429 Too Many Requests` with RFC 7807 Problem Details format. See `/docs/site/errors/too-many-requests.md` for client retry guidance.
- **Mailgun webhook delivery tracking** — `POST /v1/mailgun/webhook` receives Mailgun delivery events and updates `email_status` accordingly. Handles four event types: `delivered` → `DELIVERED`, `failed` (permanent) → `FAILED`, `failed` (temporary, no status change) → logs `EMAIL_TEMP_FAILED`, `complained` → `COMPLAINED`. All requests are verified with HMAC-SHA256 (`MAILGUN_WEBHOOK_SIGNING_KEY`) with 5-minute replay protection.
- `email_message_id` column on `documents` — stores Mailgun's queued message ID (angle brackets stripped) so webhook events can be correlated back to the right document.
- `DELIVERED` and `COMPLAINED` added to the `documents_email_status_check` constraint.
- `EMAIL_DELIVERED`, `EMAIL_TEMP_FAILED`, `EMAIL_COMPLAINED` added to `chk_document_events_event_type` constraint.
- `MAILGUN_WEBHOOK_SIGNING_KEY` environment variable (Mailgun dashboard → Sending → Webhooks → Webhook signing key).
- `revokeExisting` option on `POST /v1/admin/issuers/:id/api-keys` — pass `true` to revoke all active keys for the issuer atomically before issuing the new one, enabling safe key rotation and lost-key recovery in a single request.
- `revokeAllByIssuerId` on `api-key.model`.

### Changed
- `src/controllers/invoices.controller.js` renamed to `src/controllers/documents.controller.js` to match the document-agnostic route and service layer.
- `POST /v1/admin/issuers` now returns `409 Conflict` with a descriptive message when a duplicate `(ruc, branch_code, issue_point_code)` combination is submitted, instead of a generic 500.
- `initialSequentials` (array of `{ documentType, sequential }`) replaces the flat `initialSequential` + `documentType` pair on `POST /v1/admin/issuers`, allowing counters for multiple document types to be seeded in one request.
- `mailgun.provider.send()` now returns `{ messageId }` (angle brackets stripped from Mailgun's response `id`) instead of `void`.
- `email.service.sendInvoiceAuthorized()` now returns `{ sent: true, messageId }` on success.
- `email_status` on send success now also stores `email_message_id` so subsequent webhook calls can look up the document.

### Fixed
- Missing `return` before `Promise.all(...)` in the `.catch()` block of `checkAuthorization()` fire-and-forget email path.

---

## [3.0.0] — 2026-03-01

### Breaking Changes

- **`documentType` is now required** on `POST /api/documents` — no silent default. Callers that previously omitted this field and relied on the implicit `'01'` default will receive a `400` validation error.
- **API routes renamed** from `/api/invoices/*` to `/api/documents/*`. All client integrations must update their base path.
- **`cert_path` and `cert_password_enc` columns removed** from `issuers` (migration 028). The database schema must be migrated before upgrading. These are replaced by `encrypted_private_key`, `certificate_pem`, `cert_fingerprint`, and `cert_expiry`.

### Added

- **Admin API** — `POST /api/admin/issuers`, `GET /api/admin/issuers`, `POST /api/admin/issuers/:id/api-keys`, `DELETE /api/admin/api-keys/:id` protected by `ADMIN_SECRET` (constant-time comparison). Replaces the dev seeder for issuer provisioning.
- **PEM-in-database certificate storage** — P12 uploaded via the admin API is parsed in-process; private key PEM is AES-256-GCM encrypted and stored in `issuers.encrypted_private_key`; certificate PEM stored plaintext in `issuers.certificate_pem`. No filesystem certificate files required.
- **Multi-branch issuer support** — `POST /api/admin/issuers` accepts `sourceIssuerId` to copy cert material from an existing issuer row, supporting multiple `(branch_code, issue_point_code)` pairs under the same RUC without re-uploading the P12.
- **Sequential counter seeding** — `POST /api/admin/issuers` accepts optional `initialSequentials` (array of `{ documentType, sequential }`) to pre-seed counters for one or more document types, enabling migrating issuers that have already issued documents outside this system.
- **Multi-tenancy via Bearer API key authentication** — each request is authenticated by `Authorization: Bearer <token>`; the token resolves to an issuer row attached as `req.issuer`. Replaces the single-tenant `issuerModel.findFirst()` pattern.
- **Document state machine** — `src/constants/document-state-machine.js` defines the allowed transition graph; `assertTransition(from, to)` is called at the top of each service operation. Enforced at the DB level by `trg_document_state_transition` (migration 027) as defence in depth.
- **Document immutability triggers** — `trg_document_immutability` (migration 026) protects permanently immutable columns (`access_key`, `sequential`, `issuer_id`) and set-once authorization fields at the PostgreSQL level.
- **Email delivery** — when a document becomes `AUTHORIZED`, `emailService.sendInvoiceAuthorized()` is called fire-and-forget. Sends RIDE PDF + signed XML as attachments via Mailgun. Per-document `email_status` tracked (`PENDING` → `SENT` / `FAILED` / `SKIPPED`).
- **Email retry** — `POST /api/documents/email-retry` (batch, up to 100 docs) and `POST /api/documents/:key/email-retry` (single, `?force=true` to resend an already-sent email).
- **Idempotency key** — `POST /api/documents` accepts an optional `Idempotency-Key` header. Duplicate key + matching body → 200 replay. Duplicate key + different body → 409. Concurrent races handled via `23505` catch-and-fetch.
- **Audit trail endpoint** — `GET /api/documents/:key/events` returns the full `document_events` history for a document.
- **Rebuild** — `POST /api/documents/:key/rebuild` re-signs a `RETURNED` or `NOT_AUTHORIZED` document with corrected content, reusing the same access key and sequential.
- `ConflictError` (409) error class added to the hierarchy.
- `multer` dependency (memory storage, P12 never written to disk).
- Migrations 019–028.

### Changed

- `helpers/signer.js` signature changed from `sign(certPath, password, xml)` to `sign(privateKeyPem, certPem, xml)` — no longer reads any file from disk.
- `signing.service.js` now decrypts `issuer.encrypted_private_key` (private key PEM) instead of `issuer.cert_password_enc` (cert password).
- `document.service.js` split into five focused services: `document-creation`, `document-transmission`, `document-rebuild`, `document-email`, `document-query`.
- `invoice_details` table renamed to `document_line_items`.
- Master data tables (`clients`, `products`) removed — buyer information is stored directly on `documents`.
- `issuers` unique constraint changed from `(ruc)` to `(ruc, branch_code, issue_point_code)`.
- `document-rebuild.service.js` now reads `document.document_type` from the stored record instead of hardcoding `'01'`.

### Removed

- `cert_path`, `cert_password_enc` columns from `issuers`.
- `db/seeders/dev-issuer.js` and `seed:dev` npm script.
- `issuerModel.findFirst()` — issuers are resolved exclusively via `apiKeyModel.findByKeyHash()` during authentication.

---

## [2.2.0] — 2026-02-28

### Added
- **RIDE PDF generator** — `GET /api/invoices/:accessKey/ride` returns `application/pdf` for any `AUTHORIZED` document; returns `400` for any other status
- `helpers/ride-builder.js` — PDFKit A4 renderer with two-column issuer/document header (logo, RUC, FACTURA, No., auth number, AMBIENTE, EMISIÓN, ESTADO: AUTORIZADO, barcode, access key), buyer info section, 10-column line items table (Cod. Principal, Cod. Auxiliar, Cantidad, Descripción, Detalle Adicional, Precio Unitario, Subsidio, Precio sin Subsidio, Descuento, Precio Total), and bottom section with Información Adicional + Forma de pago (left) and full SRI tax breakdown (right)
- `src/services/ride.service.js` — orchestrates document load, issuer load, and catalog label resolution before calling the builder
- `catalog.model.js` — `getIdTypeLabel`, `getPaymentMethodLabel`, `getTaxRateDescription` label lookup functions with per-table Map cache
- Migration `018` — nullable `logo_path VARCHAR(500)` column on `issuers`
- `pdfkit` and `bwip-js` (both MIT) added as runtime dependencies

### Fixed
- Tax subtotal rows correctly separated by SRI rate code: `'0'`=0%, `'6'`=No objeto de IVA, `'7'`=Exento de IVA — never merged despite all having `rate=0` in the catalog
- Row heights in the bottom section pre-measured with `doc.heightOfString()` so long wrapping values (Información Adicional, payment method labels) never overflow their boxes

### Changed
- Replaced `libxmljs2` (end-of-life) with `xmllint` system CLI for XSD validation — zero npm footprint, actively maintained by OS
- Updated all dependencies to latest secure versions within current major versions (Express 4.22.1, node-forge 1.3.3, dotenv 16.6.1)
- Resolved 10 npm audit vulnerabilities (6 high, 1 moderate, 3 low) → 0 remaining

### Removed
- Deleted legacy pre-refactor files: old `controllers/`, `routes/`, `models/server.js`, `cert/certs.js`, `db/catalogos.js`, flat-file JSON stores
- Removed unused helper aggregator and `manejo-data.js`

### Renamed
- `helpers/firmar.js` → `helpers/signer.js`
- `helpers/generar-clave-acceso.js` → `helpers/access-key-generator.js` (all Spanish identifiers translated to English)

---

## [2.1.0] — 2026-02-27

### Added
- **Audit trail** — `document_events` table logs every lifecycle transition (CREATED, SENT, STATUS_CHANGED, ERROR) with from/to status and detail JSON
- **Structured line items** — `invoice_details` table persists each invoice item for future reporting without re-parsing XML
- **Client catalogue** — `clients` table upserted on every invoice creation, building a buyer record over time
- **Product catalogue** — `products` table for future product-based invoice generation
- **Buyer index** — `idx_documents_buyer_id` index on `documents` for efficient buyer lookups
- **XSD pre-validation** — XML validated against `factura_V2.1.0.xsd` before signing; invalid documents return a structured 400 with specific XSD errors
- **Retry logic** — Both SRI SOAP calls retry up to 3 times with exponential backoff (1 s → 2 s → 4 s) on network failures
- `NEXT_STEPS.md` documenting deferred features

### Changed
- `document.service.js` orchestrates line item persistence, audit events, and buyer upsert on every `create()` call
- SRI network errors now log an `ERROR` audit event before re-throwing

---

## [2.0.0] — 2026-02-26

### Added
- Full layered architecture: Route → Validator → Controller → Service → Model
- PostgreSQL persistence replacing flat JSON files — tables: `issuers`, `documents`, `sequential_numbers`, `sri_responses`
- `SELECT FOR UPDATE` row-level locking for concurrency-safe sequential number generation
- AES-256-GCM encryption for certificate passwords stored in the database
- `document.service.js` orchestrating the full invoice lifecycle (create, send, authorize)
- `access-key.service.js` wrapping the 49-digit SRI access key generator
- `signing.service.js` wrapping XAdES-BES signing with decrypted certificate password
- `sri.service.js` handling both SRI SOAP endpoints (reception + authorization)
- `xml-validator.service.js` for XSD schema validation
- Typed error hierarchy: `AppError`, `ValidationError`, `NotFoundError`, `SriError`
- `asyncHandler` and `validateRequest` middleware
- Builder registry pattern for XML document construction (`InvoiceBuilder`, `BaseDocumentBuilder`)
- `express-validator` chains for all request fields
- Jest unit tests with full mock isolation
- SQL migration runner (`npm run migrate`)
- `CLAUDE.md` with project guidance for AI coding assistants

### Removed
- Flat-file JSON sequential number storage
- Hardcoded invoice data in controllers
- Single-file architecture (old `models/server.js`)

---

## [1.0.0] — 2025

### Added
- Initial proof-of-concept: generate and sign a factura electrónica XML
- XAdES-BES signing via `node-forge` (`helpers/signer.js`)
- 49-digit SRI access key generation with Module 11 check digit (`helpers/access-key-generator.js`)
- Basic Express server with `/api/facturas` endpoint
