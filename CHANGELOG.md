# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

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
