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
src/controllers/   thin HTTP handlers — one service call, one response
src/services/      business logic and orchestration
src/models/        PostgreSQL CRUD (parameterised queries only)
src/builders/      XML document construction (builder registry)
src/errors/        AppError → ValidationError / NotFoundError / SriError
helpers/           signer.js (XAdES-BES), access-key-generator.js (Module 11)
db/migrations/     SQL migration files 001–010
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

**Audit trail:** every lifecycle transition → `document_events` row. Event types: `CREATED`, `SENT`, `STATUS_CHANGED`, `ERROR`.

**Builder registry:** `src/builders/index.js` maps document type codes to builder classes. Adding a new document type = new builder + one registry entry.

---

## Document Lifecycle

```
POST /api/invoices → SIGNED
POST /:key/send   → RECEIVED | RETURNED
GET  /:key/authorize → AUTHORIZED | NOT_AUTHORIZED
```

**Invoice generation steps:**
1. Load issuer (`issuers` table)
2. `SELECT ... FOR UPDATE` → next sequential
3. Generate 49-digit access key (Module 11 check digit)
4. Build unsigned XML (`InvoiceBuilder`)
5. Validate against XSD (`xmllint`)
6. Sign XML (XAdES-BES, P12 cert)
7. `INSERT` into `documents`
8. `bulkCreate` into `invoice_details`
9. Log `CREATED` event to `document_events`
10. Fire-and-forget upsert into `clients`

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

---

## Key Files

| File | Purpose |
|------|---------|
| `GETTING_STARTED.md` | Local setup guide |
| `docs/guides/code-flow.md` | Layer-by-layer request walkthrough |
| `docs/guides/coding-guidelines.md` | Patterns and examples for adding features |
| `docs/adr/` | Architecture Decision Records |
| `src/services/document.service.js` | Main orchestrator — invoice lifecycle |
| `src/services/sri.service.js` | SRI SOAP integration + retry logic |
| `src/services/xml-validator.service.js` | XSD pre-validation via xmllint |
| `src/services/sequential.service.js` | FOR UPDATE sequential locking |
| `src/builders/index.js` | Builder registry |
| `db/migrations/` | All 10 SQL migrations |
| `assets/factura_V2.1.0.xsd` | Official SRI invoice schema |
| `.example.env` | Environment variable template |
