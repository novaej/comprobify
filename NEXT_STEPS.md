# Next Steps

Features deferred from the SRI gap analysis. Implement when the core lifecycle is stable and in production.

## Idempotency Key ⚠️ Priority

Submitting the same request body twice creates two separate invoices — each gets a new sequential and access key. There is currently no duplicate detection on content.

To prevent this, callers should send a unique idempotency key per intended invoice (e.g. their internal order ID). The API would:

- Accept an `Idempotency-Key` header (or `idempotencyKey` body field)
- Store it in a dedicated `idempotency_key` column on `documents` (with a UNIQUE constraint)
- On a duplicate key: return the existing document with `200` instead of creating a new one
- On a key conflict with a different payload: return `409 Conflict`

**Now more urgent with email delivery live:** a network retry on `POST /api/invoices` creates a second invoice that, once authorized, fires a second email to the buyer — duplicating both the document and the notification. This must be implemented before enabling the async queue, where retries are frequent by design.

---

## Authentication & Authorization

- API key or JWT authentication middleware
- Role-based access control (admin, issuer, read-only)
- Per-issuer API keys stored in DB

## Additional Document Types

Builders for document type codes:
- `03` — Liquidación de compra
- `04` — Nota de crédito
- `05` — Nota de débito
- `06` — Guía de remisión
- `07` — Comprobante de retención

## ~~Email Delivery~~ ✅ Done

Implemented in migration 019–020 and `src/services/email/`:
- RIDE PDF + authorization XML sent on `AUTHORIZED` (fire-and-forget, no storage)
- Mailgun provider via `mailgun.js`; swap by adding a new file in `src/services/email/providers/`
- Per-document `email_status` tracking: `PENDING` → `SENT` / `FAILED` / `SKIPPED`
- Batch retry: `POST /api/invoices/email-retry`
- Single retry: `POST /api/invoices/:accessKey/email-retry`
- XML download: `GET /api/invoices/:accessKey/xml`

Remaining: issuer logo (`logo_path`) not yet rendered in emails (column exists in `issuers` via migration 018).

## Reporting Module

- Endpoints for revenue summaries, document counts by status/date/issuer
- Export to CSV/Excel

## Async Queue (Worker)

- Background worker for send + authorize steps (bull or pg-boss)
- Removes SRI network latency from HTTP response path
- Dead-letter queue for permanently failed documents
- **Requires idempotency key first** — retries would otherwise create duplicate invoices and duplicate emails

## Docker / Containers

- `Dockerfile` and `docker-compose.yml` with app + PostgreSQL
- Health check endpoint (`GET /health`)

## OpenAPI / Swagger

- `openapi.yaml` spec for all endpoints
- Swagger UI served at `/docs`
