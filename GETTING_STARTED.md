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
```

> **Issuer data (RUC, branch code, issue point, SRI environment, certificate path/password) is stored per-issuer in the `issuers` database table — not in `.env`.** This allows multiple issuers to be configured independently.

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

This creates all 10 tables: `issuers`, `documents`, `sequential_numbers`, `sri_responses`, `document_events`, `invoice_details`, `clients`, `products`, and the catalog tables.

---

## 8. Seed the development issuer

Fill in the `DEV_ISSUER_*` variables in your `.env` file (copied from `.example.env` in step 3), then run:

```bash
npm run seed:dev
```

This encrypts `CERT_PASSWORD` automatically and upserts the issuer row — safe to run multiple times.

> For production, insert the issuer directly via SQL with a real encrypted password (see step 5 for how to encrypt it).

---

## 9. Start the server

```bash
npm start
```

The API is available at: **http://localhost:8080**

---

## 10. Verify

```bash
curl -s http://localhost:8080/api/invoices/0000000000000000000000000000000000000000000000000 | jq
# → { "ok": false, "message": "Document not found" }
```

A 404 response confirms the server is running and routing correctly.

---

## Troubleshooting

**`ENCRYPTION_KEY must be a 64-character hex string`**
The `ENCRYPTION_KEY` in `.env` is missing or wrong length. Re-run step 4.

**`No active issuer configured`**
No row in the `issuers` table, or `active = false`. Complete step 8.

**`Migration X failed`**
Check that the database exists and credentials in `.env` are correct. Re-run `npm run migrate` — already-applied migrations are skipped automatically.

**`xmllint: command not found`**
Install libxml2: `brew install libxml2` (macOS) or `apt install libxml2-utils` (Ubuntu).

**`Invalid certificate, certificate has expired`**
Your P12 certificate's validity period has passed. Renew it from your certificate authority (Banco Central del Ecuador or Security Data).

**Port already in use**
Change `PORT` in `.env` or stop the conflicting process: `lsof -i :8080`.
