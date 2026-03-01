# Next Steps

Features deferred from the SRI gap analysis. Implement when the core lifecycle is stable and in production.

## Idempotency Key

Submitting the same request body twice creates two separate invoices — each gets a new sequential and access key. There is currently no duplicate detection on content.

To prevent this, callers should send a unique idempotency key per intended invoice (e.g. their internal order ID). The API would:

- Accept an `Idempotency-Key` header (or `idempotencyKey` body field)
- Store it in a dedicated `idempotency_key` column on `documents` (with a UNIQUE constraint)
- On a duplicate key: return the existing document with `200` instead of creating a new one
- On a key conflict with a different payload: return `409 Conflict`

This is especially important before enabling the async queue, where retries could otherwise produce duplicate invoices.

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

## Email Delivery

- Send signed XML + RIDE PDF to buyer email on authorization
- Configurable SMTP (nodemailer)
- Retry queue for failed deliveries
- Attach `logo_path` per issuer (column already exists in `issuers` via migration 018)

## Reporting Module

- Endpoints for revenue summaries, document counts by status/date/issuer
- Export to CSV/Excel

## Async Queue (Worker)

- Background worker for send + authorize steps (bull or pg-boss)
- Removes SRI network latency from HTTP response path
- Dead-letter queue for permanently failed documents

## Docker / Containers

- `Dockerfile` and `docker-compose.yml` with app + PostgreSQL
- Health check endpoint (`GET /health`)

## OpenAPI / Swagger

- `openapi.yaml` spec for all endpoints
- Swagger UI served at `/docs`
