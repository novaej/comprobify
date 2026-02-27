# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Node.js REST API (Express.js) for generating, digitally signing, and submitting electronic invoices (facturas electrónicas) to Ecuador's SRI (Servicio de Rentas Internas). Supports the full document lifecycle: Generate → Sign → Send → Authorize. Uses PostgreSQL for persistence with concurrency-safe sequential numbers.

## Commands

- **Start server:** `npm start` or `node app.js` (runs on port from `.env`, default 8080)
- **Install dependencies:** `npm install`
- **Run migrations:** `npm run migrate`
- **Run all tests:** `npm test`
- **Run unit tests:** `npm run test:unit`
- **Run integration tests:** `npm run test:integration` (requires test DB)

## Environment Setup

1. Copy `.example.env` to `.env` and fill in values
2. Place P12 digital certificate at `cert/token.p12`
3. Create PostgreSQL database and run `npm run migrate`
4. Generate encryption key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
5. Set `ENCRYPTION_KEY` in `.env`

## Naming Convention

Code uses **English** for identifiers, file names, variable names, table names, and column names. Spanish is used only where SRI requires it (XML element names like `infoTributaria`, `claveAcceso`, SRI SOAP payloads).

## Architecture

**Pattern:** Layered Express REST API — Route → Controller → Service → Model (PostgreSQL)

**Request flow:** Route (`src/routes/`) → Validator → Controller (`src/controllers/`) → Service (`src/services/`) → Model (`src/models/`) / Builder (`src/builders/`)

### Key directories

- `src/server.js` — Express server class (middleware, routes, error handling)
- `src/config/` — Central config (`index.js`) and pg Pool setup (`database.js`)
- `src/controllers/invoices.controller.js` — Thin controller: validate → delegate → respond
- `src/services/` — Business logic layer:
  - `document.service.js` — Orchestrator: create, sign, send, authorize
  - `sequential.service.js` — Sequential numbers with SELECT FOR UPDATE locking
  - `access-key.service.js` — Wraps helpers/generar-clave-acceso.js
  - `signing.service.js` — Wraps helpers/firmar.js, decrypts cert password
  - `sri.service.js` — SOAP calls to SRI web services
  - `crypto.service.js` — AES-256-GCM encrypt/decrypt for sensitive data
- `src/builders/` — XML document construction:
  - `base.builder.js` — Shared infoTributaria, XML attributes, toXml()
  - `invoice.builder.js` — Factura-specific: infoFactura, detalles, pagos
  - `index.js` — Builder registry by document type code
- `src/models/` — PostgreSQL CRUD:
  - `document.model.js`, `issuer.model.js`, `sequential.model.js`, `sri-response.model.js`
- `src/validators/` — express-validator chains for request validation
- `src/middleware/` — error-handler, validate-request, async-handler
- `src/errors/` — Typed error classes (AppError, ValidationError, SriError, NotFoundError)
- `helpers/` — Legacy utilities (PRESERVED, wrapped by services):
  - `generar-clave-acceso.js` — 49-digit SRI access key with Module 11 check digit
  - `firmar.js` — XAdES-BES XML signing using node-forge
- `db/migrations/` — SQL migration files (run with `npm run migrate`)
- `cert/` — P12 certificate storage
- `assets/` — SRI XML schema and example files
- `tests/unit/` — Jest unit tests
- `tests/integration/` — Jest integration tests

### Document lifecycle

```
POST /api/invoices → SIGNED → POST /:key/send → RECEIVED → GET /:key/authorize → AUTHORIZED
                                     │                            │
                                     → RETURNED                   → NOT_AUTHORIZED
```

### Invoice generation pipeline

1. Load issuer from PostgreSQL `issuers` table
2. Get next sequential with row-level locking (`SELECT ... FOR UPDATE`)
3. Generate 49-digit SRI access key (date + doc type + RUC + environment + series + sequential + check digit)
4. Build invoice XML via InvoiceBuilder (infoTributaria + infoFactura + detalles + pagos)
5. Digitally sign XML using P12 certificate (XAdES-BES with SHA-1/RSA-2048)
6. Save document to PostgreSQL `documents` table
7. Return document metadata as JSON

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/invoices` | Create and sign a new invoice |
| GET | `/api/invoices/:accessKey` | Get document details |
| POST | `/api/invoices/:accessKey/send` | Send signed XML to SRI |
| GET | `/api/invoices/:accessKey/authorize` | Check authorization at SRI |

## Database

PostgreSQL with `pg` (raw client, parameterized queries). Tables: `issuers`, `documents`, `sequential_numbers`, `sri_responses`, `cat_document_types`, `cat_emission_types`.

## Testing

Jest. Unit tests mock all dependencies. Integration tests require a test PostgreSQL database.
