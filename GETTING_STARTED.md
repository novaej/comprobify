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
cd comprobify
```

---

## 2. Database setup

> **RLS requirement:** the application user must **not** be a PostgreSQL superuser — superusers bypass Row-Level Security unconditionally. Always use a dedicated non-superuser role (e.g. `comprobify_app`).

### Option A — Local PostgreSQL install (native, not Docker)

> These `psql` commands connect via Unix socket to a locally-installed PostgreSQL. **If your PostgreSQL runs in Docker, use Option B instead** — `psql -U postgres` without `-h` will connect to the local socket (which doesn't exist in Docker) and your grants will silently target the wrong server.

```bash
# Create the database and the application role
psql -U postgres -c "CREATE DATABASE comprobify_local;"
psql -U postgres -c "CREATE ROLE comprobify_app LOGIN PASSWORD 'changeme';"

# Grant database access
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE comprobify_local TO comprobify_app;"

# Grant schema access — required on PostgreSQL 15+ where the public schema
# no longer has default CREATE/USAGE granted to all users
psql -U postgres -d comprobify_local -c "GRANT ALL ON SCHEMA public TO PUBLIC;"
psql -U postgres -d comprobify_local -c "GRANT ALL ON SCHEMA public TO comprobify_app;"

# Grant access to objects created by superuser migrations
psql -U postgres -d comprobify_local -c "ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO comprobify_app;"
psql -U postgres -d comprobify_local -c "ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO comprobify_app;"
```

Set `DB_USER=comprobify_app` and `DB_PASSWORD=changeme` in `.env`.

### Option B — Docker

```bash
# Start the container
docker run --name postgres16 \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=comprobify_local \
  -p 5432:5432 \
  -d postgres:16

# Wait a moment for Postgres to initialise, then create the application role.
# Role creation is run as a separate command so that if the role already exists
# and errors, it does not abort the grant block below.
docker exec -it postgres16 psql -U postgres -c "CREATE ROLE comprobify_app LOGIN PASSWORD 'changeme';"

# Grant all required privileges:
docker exec -it postgres16 psql -U postgres -d comprobify_local -c "
  GRANT ALL PRIVILEGES ON DATABASE comprobify_local TO comprobify_app;
  GRANT ALL ON SCHEMA public TO PUBLIC;
  GRANT ALL ON SCHEMA public TO comprobify_app;
  ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO comprobify_app;
  ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO comprobify_app;
"
```

Set `DB_USER=comprobify_app` and `DB_PASSWORD=changeme` in `.env`.

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
DB_NAME=comprobify_local
DB_USER=postgres
DB_PASSWORD=
DB_SSL=false

# App environment — controls SRI endpoint routing
# staging    → always hits the SRI test endpoint (safe default)
# production → uses SRI production endpoint for issuers with sandbox=false
APP_ENV=staging

# 32-byte AES encryption key for private keys stored in the database
ENCRYPTION_KEY=             # see step 4

# Admin API secret — protects /admin/* endpoints (see step 5)
ADMIN_SECRET=               # see step 5

# Email delivery (optional — omit to disable buyer notifications)
EMAIL_PROVIDER=mailgun
# Bare email address only — display name is built dynamically:
# "{Issuer Business Name} via Comprobify <EMAIL_FROM>"
EMAIL_FROM=comprobantes@mg.yourdomain.com
MAILGUN_API_KEY=
MAILGUN_DOMAIN=mg.yourdomain.com
# From Mailgun dashboard → Sending → Webhooks → Webhook signing key
MAILGUN_WEBHOOK_SIGNING_KEY=
```

> **Issuer data (RUC, branch code, issue point, certificate) is stored per-issuer in the `issuers` database table — not in `.env`.** The admin API in step 8 populates it. Each issuer has a `sandbox` flag (default `true` — test mode). Set `sandbox=false` only on production issuers and only when `APP_ENV=production` in `.env`.

> **Email delivery is optional.** If `MAILGUN_API_KEY` or `MAILGUN_DOMAIN` are not set, the server still runs normally — emails are simply not sent and `email_status` stays `PENDING`.

---

## 4. Generate encryption key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output into `ENCRYPTION_KEY` in `.env`.

---

## 5. Generate admin secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output into `ADMIN_SECRET` in `.env`. This secret protects all `/admin/*` endpoints — treat it like a password. Keep it behind an internal firewall and never expose it on the public internet.

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

This applies all 33 migrations, creating tables: `issuers`, `api_keys`, `documents`, `sequential_numbers`, `sri_responses`, `document_line_items`, `document_events`, and the catalog tables (`cat_document_types`, `cat_emission_types`, `cat_id_types`, `cat_tax_types`, `cat_tax_rates`, `cat_payment_methods`). It also installs two PostgreSQL triggers for document state machine and immutability enforcement, enables Row-Level Security on all tenant-scoped tables, and creates the `sandbox` schema (an identical copy of the tenant-scoped tables for test documents). Already-applied migrations are skipped automatically.

> **After migrating — grant sandbox schema access:** migration 033 creates the `sandbox` schema. If the migration runner connects as `comprobify_app` (recommended), `comprobify_app` owns the schema and no extra grants are needed. If you ran migrations as a superuser (`postgres`), grant access manually:
>
> **Local:**
> ```bash
> psql -U postgres -d comprobify_local -c "GRANT ALL ON SCHEMA sandbox TO comprobify_app;"
> psql -U postgres -d comprobify_local -c "ALTER DEFAULT PRIVILEGES IN SCHEMA sandbox GRANT ALL ON TABLES TO comprobify_app;"
> psql -U postgres -d comprobify_local -c "ALTER DEFAULT PRIVILEGES IN SCHEMA sandbox GRANT ALL ON SEQUENCES TO comprobify_app;"
> ```
> **Docker:**
> ```bash
> docker exec -it postgres16 psql -U postgres -d comprobify_local -c "
>   GRANT ALL ON SCHEMA sandbox TO comprobify_app;
>   ALTER DEFAULT PRIVILEGES IN SCHEMA sandbox GRANT ALL ON TABLES TO comprobify_app;
>   ALTER DEFAULT PRIVILEGES IN SCHEMA sandbox GRANT ALL ON SEQUENCES TO comprobify_app;
> "
> ```

---

## 8. Create your first issuer and API key

Use the admin API to upload your P12 certificate, extract and store the keys, and generate your first Bearer token — all in one request.

### New certificate (first issuer or new RUC)

```bash
curl -s -X POST http://localhost:8080/api/admin/issuers \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -F "ruc=1700000000001" \
  -F "businessName=Acme S.A." \
  -F "tradeName=Acme" \
  -F "mainAddress=123 Test Street" \
  -F "branchCode=001" \
  -F "issuePointCode=001" \
  -F "environment=1" \
  -F "emissionType=1" \
  -F "requiredAccounting=false" \
  -F "specialTaxpayer=" \
  -F "branchAddress=123 Test Street" \
  -F "certPassword=YOUR_P12_PASSWORD" \
  -F "cert=@/path/to/token.p12" | jq
```

Response:

```json
{
  "ok": true,
  "issuer": { "id": 1, "ruc": "1700000000001", ... },
  "apiKey": "a3f8c2...64 hex chars..."
}
```

**Save the `apiKey`** — it is printed once and never stored in plaintext. Use it as `Authorization: Bearer <apiKey>` on every `POST /api/documents` request.

### Seeding sequential counters (migrating an existing issuer)

If the issuer has already issued documents outside this system, pass `initialSequentials` to pre-seed the counters so the next document picks up from the right number. Each entry takes a `documentType` code and the **next** sequential you want the system to issue:

```bash
curl -s -X POST http://localhost:8080/api/admin/issuers \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -F "ruc=1700000000001" \
  -F "businessName=Acme S.A." \
  -F "tradeName=Acme" \
  -F "mainAddress=123 Test Street" \
  -F "branchCode=001" \
  -F "issuePointCode=001" \
  -F "environment=1" \
  -F "emissionType=1" \
  -F "requiredAccounting=false" \
  -F "specialTaxpayer=" \
  -F "branchAddress=123 Test Street" \
  -F "certPassword=YOUR_P12_PASSWORD" \
  -F "cert=@/path/to/token.p12" \
  -F 'initialSequentials=[{"documentType":"01","sequential":500},{"documentType":"04","sequential":12}]' | jq
```

This seeds the invoice counter (`01`) so the first document created will be `000000500`, and the credit note counter (`04`) so the first will be `000000012`. Omit `initialSequentials` entirely if starting from `000000001`.

---

### Additional branch (reuse existing certificate)

If the same RUC has multiple branch/issue-point combinations, copy the certificate from an existing issuer row instead of re-uploading the P12:

```bash
curl -s -X POST http://localhost:8080/api/admin/issuers \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -F "ruc=1700000000001" \
  -F "businessName=Acme S.A." \
  -F "tradeName=Acme" \
  -F "mainAddress=123 Test Street" \
  -F "branchCode=002" \
  -F "issuePointCode=001" \
  -F "environment=1" \
  -F "emissionType=1" \
  -F "requiredAccounting=false" \
  -F "specialTaxpayer=" \
  -F "branchAddress=Warehouse Location" \
  -F "sourceIssuerId=1" | jq
```

---

## 9. Start the server

```bash
npm start
```

The API is available at: **http://localhost:8080**

---

## 10. Verify

```bash
# Replace <token> with the Bearer token returned by POST /api/admin/issuers
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
    "documentType": "01",
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
        "rateCode": "4",
        "rate": "15.00",
        "taxBase": "100.00",
        "value": "15.00"
      }]
    }],
    "payments": [{ "method": "20", "total": "115.00" }]
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
# Then re-create your issuer via the admin API (see step 8 above)
```

---

## Mailgun webhook (email delivery tracking)

When a document is authorized, the system sends the RIDE PDF and XML to the buyer's email via Mailgun and records the queued message ID in `documents.email_message_id`. To track actual delivery, configure a Mailgun webhook so Mailgun calls back with the result.

### Setup

1. Get the signing key: **Mailgun dashboard → Sending → Webhooks → Webhook signing key**. Copy it into `MAILGUN_WEBHOOK_SIGNING_KEY` in `.env`.

2. Register the webhook URL in Mailgun for your domain. Check the following event types:
   - Delivered messages
   - Permanent failure
   - Temporary failure
   - Spam complaints

   **Dev:** use [ngrok](https://ngrok.com) to expose your local server:
   ```bash
   ngrok http 8080
   # Use the printed HTTPS URL, e.g.:
   # https://abc123.ngrok-free.app/api/mailgun/webhook
   ```
   **Production:** use your server's public URL:
   ```
   https://yourdomain.com/api/mailgun/webhook
   ```

3. Restart the server so it picks up `MAILGUN_WEBHOOK_SIGNING_KEY`.

### How it works

| Mailgun event | Severity | `email_status` | `document_events` entry |
|---|---|---|---|
| `delivered` | — | `DELIVERED` | `EMAIL_DELIVERED` |
| `failed` | `permanent` | `FAILED` | `EMAIL_FAILED` |
| `failed` | `temporary` | *(unchanged — Mailgun retries)* | `EMAIL_TEMP_FAILED` |
| `complained` | — | `COMPLAINED` | `EMAIL_COMPLAINED` |

All requests are verified with HMAC-SHA256 and rejected with 401 if the signature is invalid or the timestamp is more than 5 minutes old.

---

## Troubleshooting

**`Missing or invalid Authorization header`**
Every request requires `Authorization: Bearer <token>`. Use `POST /api/admin/issuers` to create an issuer and receive its initial API key.

**`Invalid or revoked API key` / lost API key**
The token does not match any active key in `api_keys`. Generate a replacement key — pass `revokeExisting: true` to revoke all current keys for that issuer atomically:

```bash
# Find the issuer ID
curl -s http://localhost:8080/api/admin/issuers \
  -H "Authorization: Bearer $ADMIN_SECRET" | jq '.[].id'

# Generate a replacement key (revokes all existing keys)
curl -s -X POST http://localhost:8080/api/admin/issuers/<id>/api-keys \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"label": "Replacement key", "revokeExisting": true}' | jq
```

**`Missing required environment variable(s): ENCRYPTION_KEY, ADMIN_SECRET, ...`**
The server validates critical config on startup. If any required env vars are missing or malformed, the server exits immediately before starting. Fix the values in `.env` and restart.

**`Migration error: no schema has been selected to create in`**
The `public` schema is missing or the app user has no `USAGE` privilege on it. This happens on PostgreSQL 15+ after a `DROP SCHEMA public CASCADE` that was not followed by the correct grants. Fix it by running the grant commands as a superuser (see step 2 above), then re-run `npm run migrate`.

**`Migration error: permission denied for schema public`**
The app user exists but is missing `CREATE` on the `public` schema.

> **Docker users:** every `psql` command that manages privileges **must** go through `docker exec`. Running bare `psql -U postgres ...` on your Mac connects to a local PostgreSQL socket (or fails silently) — it does **not** reach the database inside the container. Grants applied to the wrong server look like they succeeded but have no effect on `comprobify_local` inside Docker.

Check what privileges the app user actually has:
```bash
# Local
psql -U postgres -d comprobify_local -c "SELECT has_schema_privilege('comprobify_app', 'public', 'USAGE') AS usage, has_schema_privilege('comprobify_app', 'public', 'CREATE') AS create;"
# Docker
docker exec -it postgres16 psql -U postgres -d comprobify_local -c "SELECT has_schema_privilege('comprobify_app', 'public', 'USAGE') AS usage, has_schema_privilege('comprobify_app', 'public', 'CREATE') AS create;"
```

Both columns must be `t`. If `create` is `f`, run the missing grant:
```bash
# Local
psql -U postgres -d comprobify_local -c "GRANT ALL ON SCHEMA public TO comprobify_app;"
# Docker
docker exec -it postgres16 psql -U postgres -d comprobify_local -c "GRANT ALL ON SCHEMA public TO comprobify_app;"
```

If you want to start completely fresh, drop the database and role and recreate them using Option B above. You must revoke all privileges before dropping the role — PostgreSQL will refuse to drop it otherwise:
```bash
docker exec -it postgres16 psql -U postgres -c "REVOKE ALL PRIVILEGES ON DATABASE comprobify_local FROM comprobify_app;"
docker exec -it postgres16 psql -U postgres -c "REVOKE ALL ON SCHEMA public FROM comprobify_app;"
docker exec -it postgres16 psql -U postgres -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON TABLES FROM comprobify_app;"
docker exec -it postgres16 psql -U postgres -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON SEQUENCES FROM comprobify_app;"
docker exec -it postgres16 psql -U postgres -c "DROP DATABASE IF EXISTS comprobify_local;"
docker exec -it postgres16 psql -U postgres -c "DROP ROLE IF EXISTS comprobify_app;"
```
Then follow Option B from step 2 to recreate everything.

**`Migration X failed: ...`**
Check that the database exists and credentials in `.env` are correct. Re-run `npm run migrate` — already-applied migrations are skipped.

**`xmllint: command not found`**
Install libxml2: `brew install libxml2` (macOS) or `apt install libxml2-utils` (Ubuntu).

**`Invalid certificate, certificate has expired`**
Your P12 certificate's validity period has passed. Renew it from your certificate authority.

**Port already in use**
Change `PORT` in `.env` or stop the conflicting process: `lsof -i :8080`.
