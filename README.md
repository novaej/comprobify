# SRI Electronic Invoice API

Node.js REST API for generating, digitally signing, and submitting electronic invoices (*facturas electrónicas*) to Ecuador's **SRI** (Servicio de Rentas Internas). Implements the full document lifecycle required by the SRI offline electronic billing specification.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  HTTP Clients                   │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              Routes + Validators                │  src/routes/  src/validators/
│   Input validation (express-validator chains)   │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│                 Controllers                     │  src/controllers/
│   Thin HTTP layer — delegate and respond        │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│                  Services                       │  src/services/
│   Business logic, orchestration, SRI calls      │
└──────────┬──────────────────────────────────────┘
           │
     ┌─────▼──────┐   ┌────────────┐   ┌──────────┐
     │   Models   │   │  Builders  │   │ Helpers  │
     │ PostgreSQL │   │  XML gen   │   │ Sign/Key │
     └────────────┘   └────────────┘   └──────────┘
```

**Dependency rule:** each layer only calls the layer below it. Controllers never touch models directly; services never construct HTTP responses.

---

## Document Lifecycle

```
POST /api/documents  (Idempotency-Key header)
       │  Generate → Sign → Save
       ▼
    SIGNED
       │
POST /:key/send  ──→  RETURNED (SRI rejected)
       │                  │
    RECEIVED         POST /:key/rebuild ─┐
       │                                │
GET /:key/authorize  ──→  NOT_AUTHORIZED┘
       │
    AUTHORIZED ──→  email queued (RIDE PDF + XML attached)
       │               │
       │         Mailgun webhook ──→  email_status: DELIVERED | FAILED | COMPLAINED
       │
GET /:key/ride  →  RIDE PDF (application/pdf)
GET /:key/xml   →  Authorization XML (application/xml)
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/documents` | Create, validate (XSD), sign, and persist a new document |
| `GET` | `/api/documents/:accessKey` | Retrieve document metadata by access key |
| `POST` | `/api/documents/:accessKey/send` | Submit signed XML to SRI reception service |
| `GET` | `/api/documents/:accessKey/authorize` | Poll SRI authorization service for final status |
| `POST` | `/api/documents/:accessKey/rebuild` | Correct and re-sign a RETURNED or NOT_AUTHORIZED document |
| `GET` | `/api/documents/:accessKey/ride` | Download RIDE PDF for an AUTHORIZED document |
| `GET` | `/api/documents/:accessKey/xml` | Download authorization XML (or signed XML if not yet authorized) |
| `GET` | `/api/documents/:accessKey/events` | Full audit trail for the document |
| `POST` | `/api/documents/email-retry` | Batch retry all PENDING/FAILED emails (max 100) |
| `POST` | `/api/documents/:accessKey/email-retry` | Retry email for one document (`?force=true` to resend already-sent) |
| `POST` | `/api/admin/issuers` | Create issuer (P12 upload or branch copy) |
| `GET` | `/api/admin/issuers` | List all issuers |
| `POST` | `/api/admin/issuers/:id/api-keys` | Generate a new Bearer API key for an issuer |
| `DELETE` | `/api/admin/api-keys/:id` | Revoke an API key |
| `POST` | `/api/mailgun/webhook` | Receive Mailgun delivery events (HMAC-verified) |

---

## Core Features

**Invoice generation pipeline**
Validates input, locks a sequential number (`SELECT FOR UPDATE`), generates the 49-digit SRI access key, builds the XML document, validates it against the official XSD schema (`xmllint`), and applies an XAdES-BES digital signature using the configured P12 certificate.

**Sequential number safety**
Each sequential counter is stored in PostgreSQL and incremented inside an explicit transaction with row-level locking, guaranteeing no duplicates even under concurrent load.

**Certificate security**
The P12 certificate password is stored AES-256-GCM encrypted in the database. The encryption key lives only in the environment — never in the codebase or the DB.

**XSD pre-validation**
The unsigned XML is validated against `factura_V2.1.0.xsd` before signing. Invalid documents are rejected with a structured 400 error listing the specific XSD violations, saving the crypto cost and avoiding cryptic SRI SOAP faults.

**Retry logic**
Both SRI SOAP calls (`sendReceipt`, `checkAuthorization`) use exponential-backoff retry (1 s → 2 s → 4 s, 3 attempts) on network-level failures only — HTTP-level SRI responses are never retried.

**Audit trail**
Every lifecycle transition writes a row to `document_events` (type, from/to status, detail JSON), giving a full tamper-evident history of each document.

**Structured line items**
Invoice details are persisted to `invoice_details` (one row per item) alongside the full signed XML, enabling future reporting queries without re-parsing the XML.

**RIDE PDF generation**
`GET /:accessKey/ride` generates the official *Representación Impresa del Documento Electrónico* on-the-fly for any `AUTHORIZED` document. Built with PDFKit (A4) and bwip-js (Code 128 barcode). Includes all SRI-mandatory fields: issuer data, buyer, line items, tax breakdown separated by legal category (15%, 0%, No objeto, Exento), payment methods, authorization number, access key barcode, and ESTADO: AUTORIZADO.

**Email delivery and webhook tracking**
When a document becomes `AUTHORIZED`, an email is sent to the buyer with the RIDE PDF and the authorization XML attached — both generated on-the-fly. Delivery is fire-and-forget (non-blocking). The Mailgun message ID is stored in `documents.email_message_id`. A Mailgun webhook (`POST /api/mailgun/webhook`) receives delivery events and updates `email_status` from `SENT` to `DELIVERED`, `FAILED`, or `COMPLAINED`. Temporary failures are logged without changing status (Mailgun retries internally). All webhook calls are HMAC-SHA256 verified. Failed sends can be retried via `POST /:key/email-retry` (single) or `POST /email-retry` (batch, up to 100).

**Idempotency key**
`POST /api/documents` accepts an optional `Idempotency-Key` header. If the same key is sent again with the same body, the original document is returned (HTTP 200) instead of creating a duplicate. If the body differs, a 409 Conflict is returned. Concurrent requests with the same key are safe — uniqueness is enforced at the database level via a partial index, and the race-losing request receives the winning document as a replay.

---

## Project Structure

```
.
├── app.js                     Entry point — loads env, starts server
├── src/
│   ├── server.js              Express class (middleware, routes, error handler)
│   ├── config/
│   │   ├── index.js           All env vars centralised here
│   │   └── database.js        pg Pool singleton
│   ├── routes/                Route definitions + validator chains
│   ├── controllers/           Thin HTTP handlers
│   ├── services/              Business logic and orchestration
│   │   └── email/             Email provider factory + Mailgun provider + templates
│   ├── models/                PostgreSQL CRUD (parameterised queries only)
│   ├── builders/              XML document construction (builder registry)
│   ├── validators/            express-validator chains
│   ├── middleware/            asyncHandler, validateRequest, errorHandler, idempotency, authenticate, verify-mailgun-webhook
│   ├── presenters/            formatDocument() shared response shape
│   └── errors/                Typed error classes (AppError hierarchy)
├── helpers/
│   ├── signer.js              XAdES-BES signing via node-forge
│   ├── access-key-generator.js  49-digit SRI access key + Module 11 check digit
│   └── ride-builder.js        PDFKit A4 RIDE renderer (Code 128 barcode via bwip-js)
├── db/
│   ├── migrate.js             Migration runner
│   └── migrations/            SQL migration files (001–030)
├── assets/
│   ├── factura_V2.1.0.xsd     Official SRI invoice schema
│   └── xmldsig-core-schema.xsd  W3C XML-DSig schema (imported by factura XSD)
├── tests/
│   ├── unit/                  Jest unit tests (all deps mocked)
│   └── integration/           Jest integration tests (requires test DB)
└── docs/                      All project documentation
```

---

## Database Schema

```
issuers (1)
  ├── api_keys                 Bearer tokens (SHA-256 hash, never plaintext)
  ├── documents (N)            One per document — stores unsigned XML, signed XML, authorization XML
  │     ├── document_line_items  One row per line item
  │     ├── document_events    Lifecycle audit log (CREATED, SENT, STATUS_CHANGED, EMAIL_*, ...)
  │     └── sri_responses      Raw SRI SOAP responses (reception + authorization)
  └── sequential_numbers       Counter per issuer/branch/point/docType (FOR UPDATE locked)
```

---

## Getting Started

See **[GETTING_STARTED.md](GETTING_STARTED.md)** for full local setup instructions.

---

## Documentation

- **[API Docs](https://novaej.github.io/comprobify)** — public endpoint and error reference (VitePress, hosted on GitHub Pages)
- **[docs/README.md](docs/README.md)** — internal documentation index (ADRs, coding guidelines, deployment guide)

---

## Production Security Checklist

- [ ] `ENCRYPTION_KEY` set to a unique 64-character hex string — never reuse across environments
- [ ] `ADMIN_SECRET` set to a unique 64-character hex string — keep behind an internal firewall
- [ ] `DB_PASSWORD` set and database not exposed publicly
- [ ] `DB_SSL=true` in production
- [ ] `.env` never committed to version control
- [ ] SRI `environment` column set to `2` only on production issuers
- [ ] All error stack traces suppressed from HTTP responses (handled by `error-handler.js`)
- [ ] `xmllint` (`libxml2-utils`) installed on the server
- [ ] `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` set for email delivery (or omit to disable)
- [ ] `EMAIL_FROM` set to a verified sender address matching the Mailgun domain
- [ ] `MAILGUN_WEBHOOK_SIGNING_KEY` set and webhook URL registered in Mailgun dashboard
- [ ] Webhook endpoint (`/api/mailgun/webhook`) publicly reachable via HTTPS

---

## License

MIT
