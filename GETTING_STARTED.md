# Getting Started

Get the API running locally from scratch.

---

## Prerequisites

| Tool | Minimum version | Install |
|------|----------------|---------|
| Node.js | 18.x | https://nodejs.org |
| npm | 9.x | bundled with Node.js |
| PostgreSQL | 14.x | https://www.postgresql.org |
| xmllint | any | `brew install libxml2` (macOS) · `apt install libxml2-utils` (Ubuntu) |

---

## 1. Clone

```bash
git clone <repo-url>
cd node-sri-fe
```

---

## 2. Database setup

### Option A — Existing PostgreSQL (local install)

```bash
psql -U postgres -c "CREATE DATABASE sri_invoicing;"
```

### Option B — Docker

```bash
docker run --name sri-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=sri_invoicing \
  -p 5432:5432 \
  -d postgres:16
```

---

## 3. Configure environment

```bash
cp .example.env .env
```

Open `.env` and fill in every value:

```env
PORT=8080

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sri_invoicing
DB_USER=postgres
DB_PASSWORD=
DB_SSL=false

# 32-byte AES encryption key for certificate passwords stored in the database
ENCRYPTION_KEY=             # see step 4

# Email delivery (optional — omit to disable buyer notifications)
EMAIL_PROVIDER=mailgun
EMAIL_FROM=Facturación <no-reply@mg.yourdomain.com>
MAILGUN_API_KEY=
MAILGUN_DOMAIN=mg.yourdomain.com
```

> **Issuer data (RUC, branch code, issue point, SRI environment, certificate path/password) is stored per-issuer in the `issuers` database table — not in `.env`.** The seeder in step 8 populates it.

> **Email delivery is optional.** If `MAILGUN_API_KEY` or `MAILGUN_DOMAIN` are not set, the server still runs normally — emails are simply not sent and `email_status` stays `PENDING`.

---

## 4. Generate encryption key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output into `ENCRYPTION_KEY` in `.env`.

---

## 5. Place your P12 certificate

Copy your `.p12` digital certificate to `cert/token.p12`.

> The `cert/` directory is gitignored — the certificate will never be committed.

To encrypt the certificate password for storage in the database, use the crypto service:

```bash
node -e "
  require('dotenv').config();
  const c = require('./src/services/crypto.service');
  console.log(c.encrypt('YOUR_P12_PASSWORD'));
"
```

Store the output in the `cert_password_enc` column of the `issuers` table.

---

## 6. Install dependencies

```bash
npm install
```

---

## 7. Run migrations

```bash
npm run migrate
```

This applies all 27 migrations, creating tables: `issuers`, `api_keys`, `documents`, `sequential_numbers`, `sri_responses`, `document_line_items`, `document_events`, and the catalog tables (`cat_document_types`, `cat_emission_types`, `cat_id_types`, `cat_tax_types`, `cat_tax_rates`, `cat_payment_methods`). Also installs two PostgreSQL triggers for document state machine and immutability enforcement. Already-applied migrations are skipped automatically.

---

## 8. Seed the development issuer and API key

Fill in the `DEV_ISSUER_*` variables in your `.env` file (copied from `.example.env` in step 3), then run:

```bash
CERT_PASSWORD=your_p12_password npm run seed:dev
```

Output:

```
✓ Dev issuer seeded — id: 1, ruc: 1700000000001, env: 1
✓ Dev API key created
  Bearer token: a3f8c2...64 hex chars...
  (Store this — it cannot be recovered from the DB)
```

**Save the Bearer token** — it is printed once and never stored in plaintext. You will use it as `Authorization: Bearer <token>` on every API request.

> Safe to run multiple times — the issuer is upserted on RUC. Each run creates a new API key.

> For production, insert the issuer directly via SQL with a real encrypted password (see step 5 for how to encrypt it), then use the admin API (or direct SQL) to create an API key.

---

## 9. Start the server

```bash
npm start
```

The API is available at: **http://localhost:8080**

---

## 10. Verify

```bash
# Replace <token> with the Bearer token printed by the seeder
curl -s http://localhost:8080/api/documents/0000000000000000000000000000000000000000000000000 \
  -H "Authorization: Bearer <token>" | jq
# → { "ok": false, "message": "Document not found" }
```

A 404 response confirms the server is running, the DB is connected, and the API key is valid.

Without the `Authorization` header:

```bash
curl -s http://localhost:8080/api/documents/0000000000000000000000000000000000000000000000000 | jq
# → { "ok": false, "message": "Missing or invalid Authorization header..." }
```

---

## Creating invoices

```bash
TOKEN=<your_bearer_token>

curl -s -X POST http://localhost:8080/api/documents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "issueDate": "01/03/2026",
    "buyer": {
      "idType": "04",
      "id": "1712345678001",
      "name": "BUYER S.A.",
      "address": "AV. TEST 123",
      "email": "buyer@example.com"
    },
    "items": [{
      "mainCode": "SVC-001",
      "description": "Professional Services",
      "quantity": "1.000000",
      "unitPrice": "100.000000",
      "discount": "0.00",
      "taxes": [{
        "code": "2",
        "rateCode": "2",
        "rate": "12.00",
        "taxBase": "100.00",
        "value": "12.00"
      }]
    }],
    "payments": [{ "method": "20", "total": "112.00" }]
  }' | jq
```

Response (201 Created):

```json
{
  "ok": true,
  "document": {
    "accessKey": "0103202601...",
    "documentType": "01",
    "sequential": "000000001",
    "status": "SIGNED",
    "issueDate": "01/03/2026",
    "total": "112.00",
    "email": { "status": "PENDING" }
  }
}
```

### Using idempotency keys

Pass `Idempotency-Key` to make retries safe:

```bash
curl -s -X POST http://localhost:8080/api/documents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: order-12345" \
  -d '{ ... }'
```

- First request → **201** (new document)
- Same key + same body → **200** (existing document, no duplicate created)
- Same key + different body → **409 Conflict**

---

## Full lifecycle (dev/test environment)

```bash
ACCESS_KEY=<accessKey from create response>

# 1. Send to SRI
curl -s -X POST http://localhost:8080/api/documents/$ACCESS_KEY/send \
  -H "Authorization: Bearer $TOKEN" | jq

# 2. Check authorization
curl -s http://localhost:8080/api/documents/$ACCESS_KEY/authorize \
  -H "Authorization: Bearer $TOKEN" | jq

# 3. Download RIDE PDF
curl -s http://localhost:8080/api/documents/$ACCESS_KEY/ride \
  -H "Authorization: Bearer $TOKEN" \
  -o RIDE-$ACCESS_KEY.pdf

# 4. Download authorization XML
curl -s http://localhost:8080/api/documents/$ACCESS_KEY/xml \
  -H "Authorization: Bearer $TOKEN" \
  -o $ACCESS_KEY.xml

# 5. View audit trail
curl -s http://localhost:8080/api/documents/$ACCESS_KEY/events \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## Reset the database (dev only)

To wipe all data and start fresh:

```bash
npm run db:reset
npm run migrate
CERT_PASSWORD=your_p12_password npm run seed:dev
```

---

## Troubleshooting

**`Missing or invalid Authorization header`**
Every request requires `Authorization: Bearer <token>`. Run `npm run seed:dev` to generate a token if you don't have one.

**`Invalid or revoked API key`**
The token does not match any active key in `api_keys`. Run `npm run seed:dev` to create a new one.

**`ENCRYPTION_KEY must be a 64-character hex string`**
The `ENCRYPTION_KEY` in `.env` is missing or wrong length. Re-run step 4.

**`Migration X failed`**
Check that the database exists and credentials in `.env` are correct. Re-run `npm run migrate` — already-applied migrations are skipped.

**`xmllint: command not found`**
Install libxml2: `brew install libxml2` (macOS) or `apt install libxml2-utils` (Ubuntu).

**`Invalid certificate, certificate has expired`**
Your P12 certificate's validity period has passed. Renew it from your certificate authority.

**Port already in use**
Change `PORT` in `.env` or stop the conflicting process: `lsof -i :8080`.
