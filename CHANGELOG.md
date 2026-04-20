# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Changed
- All primary key columns (`id`) and their referencing foreign key columns migrated from `INT` (`SERIAL`) to `BIGINT` (`BIGSERIAL`) across all tables — migration 030. Sequences updated to `BIGINT` maxvalue. No application code changes required.

### Added
- **Startup config validation** — critical environment variables (`ENCRYPTION_KEY`, `ADMIN_SECRET`, and conditional email vars) are validated on startup before the server accepts any requests. Missing or malformed config throws immediately with a clear error message (e.g., `Missing required environment variable(s): ENCRYPTION_KEY, ADMIN_SECRET`). See `src/config/validate.js`. Email vars can be opted out by setting `EMAIL_PROVIDER=none`.
- **Per-API-key rate limiting** — all authenticated endpoints are rate-limited to prevent abuse and quota exhaustion. Write endpoints (POST) limited to 60 requests/minute; read endpoints (GET) to 300 requests/minute per API key. Limits are configurable via `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX` environment variables. Exceeded limits return `429 Too Many Requests` with RFC 7807 Problem Details format. See `/docs/site/errors/too-many-requests.md` for client retry guidance.
- **Mailgun webhook delivery tracking** — `POST /api/mailgun/webhook` receives Mailgun delivery events and updates `email_status` accordingly. Handles four event types: `delivered` → `DELIVERED`, `failed` (permanent) → `FAILED`, `failed` (temporary, no status change) → logs `EMAIL_TEMP_FAILED`, `complained` → `COMPLAINED`. All requests are verified with HMAC-SHA256 (`MAILGUN_WEBHOOK_SIGNING_KEY`) with 5-minute replay protection.
- `email_message_id` column on `documents` — stores Mailgun's queued message ID (angle brackets stripped) so webhook events can be correlated back to the right document.
- `DELIVERED` and `COMPLAINED` added to the `documents_email_status_check` constraint.
- `EMAIL_DELIVERED`, `EMAIL_TEMP_FAILED`, `EMAIL_COMPLAINED` added to `chk_document_events_event_type` constraint.
- `MAILGUN_WEBHOOK_SIGNING_KEY` environment variable (Mailgun dashboard → Sending → Webhooks → Webhook signing key).
- `revokeExisting` option on `POST /api/admin/issuers/:id/api-keys` — pass `true` to revoke all active keys for the issuer atomically before issuing the new one, enabling safe key rotation and lost-key recovery in a single request.
- `revokeAllByIssuerId` on `api-key.model`.

### Changed
- `src/controllers/invoices.controller.js` renamed to `src/controllers/documents.controller.js` to match the document-agnostic route and service layer.
- `POST /api/admin/issuers` now returns `409 Conflict` with a descriptive message when a duplicate `(ruc, branch_code, issue_point_code)` combination is submitted, instead of a generic 500.
- `initialSequentials` (array of `{ documentType, sequential }`) replaces the flat `initialSequential` + `documentType` pair on `POST /api/admin/issuers`, allowing counters for multiple document types to be seeded in one request.
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
