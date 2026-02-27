# Next Steps

Features deferred from the SRI gap analysis. Implement when the core lifecycle is stable and in production.

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

## RIDE (PDF Representation)

- Generate PDF representation of signed invoices
- Use a template engine (PDFKit or puppeteer)
- Endpoint: `GET /api/invoices/:accessKey/ride`

## Email Delivery

- Send signed XML + RIDE PDF to buyer email on authorization
- Configurable SMTP (nodemailer)
- Retry queue for failed deliveries

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
