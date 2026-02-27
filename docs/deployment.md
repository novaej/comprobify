# Deployment

---

## System requirements

| Dependency | Notes |
|------------|-------|
| Node.js 18+ | LTS recommended |
| PostgreSQL 14+ | |
| `xmllint` | `apt install libxml2-utils` (Ubuntu/Debian) · pre-installed on Amazon Linux, macOS |

---

## Environment variables

All variables are required unless marked optional.

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default `8080`) |
| `DB_HOST` | PostgreSQL host |
| `DB_PORT` | PostgreSQL port (default `5432`) |
| `DB_NAME` | Database name |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |
| `DB_SSL` | `true` to enable SSL (required in production) |
| `ENCRYPTION_KEY` | 64-character hex string (32 bytes) — AES-256-GCM key for cert password encryption |

> **Issuer-specific config** (RUC, branch code, issue point, SRI environment, certificate path and password) is stored per-issuer in the `issuers` database table. This enables multiple issuers to be configured independently without changing environment variables.

Generate `ENCRYPTION_KEY`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## SRI environments

The SRI endpoint is resolved per-issuer at runtime from `issuers.environment`:

| `issuers.environment` | SRI URLs used |
|----------------------|--------------|
| `1` (test) | `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/...` |
| `2` (production) | `https://cel.sri.gob.ec/comprobantes-electronicos-ws/...` |

**Never set `environment = '2'` on a test issuer row, or `environment = '1'` on a production issuer row.**

---

## Database migrations

Migrations are cumulative SQL files in `db/migrations/`, run by `db/migrate.js`.

**Apply migrations:**
```bash
npm run migrate
```

The runner tracks applied migrations in a `migrations` table — already-applied files are skipped. It is safe to run on every deploy.

**Never modify an applied migration file.** Create a new numbered file instead.

**Manual rollback:** There is no automated rollback. To undo a migration, write a new migration that reverses the change and apply it.

---

## Certificate management

The P12 certificate password is stored AES-256-GCM encrypted in the `issuers.cert_password_enc` column. The plaintext password never appears in the codebase, logs, or config files.

To encrypt a new password:
```bash
node -e "
  require('dotenv').config();
  const c = require('./src/services/crypto.service');
  console.log(c.encrypt('PLAINTEXT_PASSWORD'));
"
```

Store the output in the database. The P12 file itself lives at `cert/token.p12` (path configurable via `CERT_PATH`).

---

## Production security checklist

- [ ] `DB_SSL=true` with a valid certificate
- [ ] `ENCRYPTION_KEY` is unique per environment — never share between staging and production
- [ ] `cert/token.p12` has restricted file permissions (`chmod 600`)
- [ ] `.env` file is not world-readable and never committed
- [ ] `ENVIRONMENT=2` only in the production deployment
- [ ] API is behind HTTPS (reverse proxy: nginx, Caddy, or load balancer TLS termination)
- [ ] PostgreSQL not exposed on a public port
- [ ] `xmllint` installed on the server (`apt install libxml2-utils`)
- [ ] Log aggregation configured — the API logs to stdout

---

## Logs

The application logs to **stdout** only. No log files are written to disk.

Key log lines to monitor:

| Message | Meaning |
|---------|---------|
| `Server running on port N` | Startup succeeded |
| `SRI fetch attempt N failed, retrying in Nms` | Transient SRI network failure — being retried |
| `Unexpected database pool error` | DB connection issue — check PostgreSQL |
| `Failed to upsert client record` | Non-critical — buyer catalogue update failed |
| `Unhandled error: ...` | Unexpected error — inspect stack trace |

---

## Health check

There is no dedicated `/health` endpoint yet (see `NEXT_STEPS.md`). A lightweight check:

```bash
curl -s http://localhost:8080/api/invoices/0000000000000000000000000000000000000000000000000
# → {"ok":false,"message":"Document not found"}   ← server up, DB connected
```

A `500` response or connection refusal indicates a problem.
