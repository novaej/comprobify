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
src/middleware/    asyncHandler, validateRequest, errorHandler, idempotency, authenticate
src/controllers/   thin HTTP handlers — one service call, one response
src/services/      business logic and orchestration
src/services/email/  email provider factory + Mailgun provider + templates
src/models/        PostgreSQL CRUD (parameterised queries only)
src/builders/      XML document construction (builder registry)
src/errors/        AppError → ValidationError / NotFoundError / SriError / ConflictError
helpers/           signer.js (XAdES-BES), access-key-generator.js (Module 11), ride-builder.js (RIDE PDF)
db/migrations/     SQL migration files 001–027
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

**Certificate password:** stored AES-256-GCM encrypted in `issuers.cert_password_enc`. Decrypted at signing time only. Key lives in `ENCRYPTION_KEY` env var.

**XSD validation:** `xmllint` CLI via `execFileSync` against `assets/factura_V2.1.0.xsd`. Must be pre-validation (before signing). `xmllint` must be installed on the server.

**Retry logic:** `fetchWithRetry` in `sri.service.js` — retries only on `fetch` throws (network), never on HTTP-level SRI responses.

**Audit trail:** every lifecycle transition → `document_events` row. Event types: `CREATED`, `SENT`, `STATUS_CHANGED`, `ERROR`, `REBUILT`, `EMAIL_SENT`, `EMAIL_FAILED`.

**Builder registry:** `src/builders/index.js` maps document type codes to builder classes. Adding a new document type = new builder + one registry entry.

**Idempotency key:** `POST /api/documents` accepts an optional `Idempotency-Key` header. The key and a SHA-256 hash of the request body are stored in `documents.idempotency_key` / `documents.payload_hash`. A duplicate key with the same payload returns the existing document (200). A duplicate key with a different payload throws `ConflictError` (409). Concurrent races are handled by catching `23505` in the transaction rollback path. See `src/middleware/idempotency.js` and ADR-006.

**Email delivery:** when a document becomes `AUTHORIZED`, `emailService.sendInvoiceAuthorized()` is called fire-and-forget. It generates the RIDE PDF and XML on the fly and sends both as attachments via Mailgun. Per-document status tracked in `documents.email_status` (`PENDING` → `SENT` / `FAILED` / `SKIPPED`). Failed sends retried via `POST /email-retry` (batch) or `POST /:key/email-retry` (single, add `?force=true` to resend an already-sent email). Provider swappable via `EMAIL_PROVIDER` env var + new file in `src/services/email/providers/`.

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
```

`rebuild` corrects invoice content (taxes, items, buyer, payments) and re-signs using the same `access_key`, `sequential`, and `issue_date`. Used when SRI returns RETURNED or NOT_AUTHORIZED.

**Invoice generation steps:**
1. Idempotency check — if key seen + hash matches, return existing doc immediately
2. Issuer provided via `req.issuer` (set by `authenticate` middleware from API key)
3. `SELECT ... FOR UPDATE` → next sequential
4. Generate 49-digit access key (Module 11 check digit)
5. Build unsigned XML (`InvoiceBuilder`)
6. Validate against XSD (`xmllint`)
7. Sign XML (XAdES-BES, P12 cert)
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

---

## Key Files

| File | Purpose |
|------|---------|
| `GETTING_STARTED.md` | Local setup guide |
| `docs/guides/code-flow.md` | Layer-by-layer request walkthrough |
| `docs/guides/coding-guidelines.md` | Patterns and examples for adding features |
| `docs/adr/` | Architecture Decision Records |
| `src/middleware/authenticate.js` | Bearer token → SHA-256 → DB lookup → `req.issuer` |
| `src/middleware/idempotency.js` | Extracts + validates `Idempotency-Key` header |
| `src/services/document-creation.service.js` | Invoice creation — sequential, XML, signing, persistence |
| `src/services/document-transmission.service.js` | SRI send + authorization check + fire-and-forget email |
| `src/services/document-rebuild.service.js` | Rebuild from RETURNED/NOT_AUTHORIZED |
| `src/services/document-email.service.js` | Batch and single email retry |
| `src/services/document-query.service.js` | Read-only document lookups |
| `src/services/email.service.js` | Sends RIDE PDF + XML on authorization via provider |
| `src/services/email/index.js` | Email provider factory (`EMAIL_PROVIDER` env var) |
| `src/services/email/providers/mailgun.provider.js` | Mailgun SDK wrapper |
| `src/services/email/templates/invoice-authorized.js` | Spanish email subject + text + HTML |
| `src/services/ride.service.js` | RIDE PDF generation — on-demand, not persisted |
| `src/services/sri.service.js` | SRI SOAP integration + retry logic |
| `src/services/xml-validator.service.js` | XSD pre-validation via xmllint (async) |
| `src/services/sequential.service.js` | FOR UPDATE sequential locking |
| `src/presenters/document.presenter.js` | `formatDocument()` — shared response shape |
| `src/models/api-key.model.js` | API key CRUD — `findByKeyHash`, `create`, `revoke` |
| `src/errors/conflict-error.js` | AppError subclass for HTTP 409 |
| `src/builders/index.js` | Builder registry |
| `helpers/ride-builder.js` | PDFKit A4 RIDE renderer (Code 128 barcode via bwip-js) |
| `src/constants/document-state-machine.js` | `TRANSITIONS` map + `canTransition` / `assertTransition` |
| `db/migrations/` | SQL migration files 001–027 |
| `assets/factura_V2.1.0.xsd` | Official SRI invoice schema |
| `.example.env` | Environment variable template |
