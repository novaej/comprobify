# ADR-009: PEM-in-Database Certificate Storage and Admin API

## Status
Accepted

## Date
2026-03-01

## Context

The system originally stored issuer certificates as P12 files on the filesystem (`issuers.cert_path`) and kept the P12 password AES-256-GCM encrypted in the database (`issuers.cert_password_enc`). At signing time, `helpers/signer.js` read the P12 file from disk, decrypted the password, and loaded both into `node-forge`.

This approach created three operational problems as the system evolved:

1. **Deployment friction.** Every deployment environment — dev, staging, production — had to have the P12 file present at the path stored in the database. Provisioning a new issuer required coordinating a filesystem write and a database write as two separate, non-atomic operations. If the path was wrong or the file missing, signing would fail at runtime with no early warning.

2. **Multi-branch support.** A single RUC can have multiple `(branch_code, issue_point_code)` combinations, each needing its own `issuers` row. Sharing the same certificate across branches required either duplicating the P12 file on disk under multiple paths or building cross-row lookup logic — both awkward.

3. **Issuer provisioning was manual.** The only way to add an issuer was `db/seeders/dev-issuer.js`, a developer script. Production deployments had no safe, API-driven way to onboard a new issuer or generate a Bearer token.

## Decision

Extract the private key PEM and certificate PEM from the P12 at upload time, store them in the database, and expose an admin API for all issuer management operations.

**Certificate storage (migration 028):**
- Drop `cert_path` and `cert_password_enc` from `issuers`.
- Add `encrypted_private_key TEXT` — the private key PEM encrypted with AES-256-GCM using `ENCRYPTION_KEY`. Format: `hex(iv):hex(authTag):hex(ciphertext)`.
- Add `certificate_pem TEXT` — the certificate PEM stored plaintext (public material; no confidentiality requirement).
- Add `cert_fingerprint VARCHAR(64)` — SHA-256 fingerprint of the DER-encoded certificate, for expiry monitoring and identification without decrypting the key.
- Add `cert_expiry TIMESTAMPTZ` — certificate validity end date, stored at upload time.
- Change the unique constraint from `(ruc)` to `(ruc, branch_code, issue_point_code)` to support multi-branch issuers.

**`helpers/signer.js` refactored** from `sign(certPath, password, xml)` to `sign(privateKeyPem, certPem, xml)` — no file I/O at signing time.

**Admin API** (`/api/admin/*`, protected by `ADMIN_SECRET` env var via constant-time comparison):
- `POST /api/admin/issuers` — accepts a multipart P12 upload (`cert` field) or a `sourceIssuerId` for branch copies. Parses the P12 in-process using `node-forge`, extracts PEMs, validates the certificate's validity period, stores everything in the database, and returns an initial Bearer API key (printed once, never stored in plaintext).
- `GET /api/admin/issuers` — lists all issuers (no PEM fields exposed).
- `POST /api/admin/issuers/:id/api-keys` — generates an additional key for an existing issuer.
- `DELETE /api/admin/api-keys/:id` — revokes a key by setting `active = false`.
- Optional `initialSequential` + `documentType` — seeds the sequential counter so migrating issuers can start from a specific number.

**`multer` (memoryStorage)** handles the P12 upload — the file is held in RAM as a `Buffer` during the request and never written to disk.

## Consequences

### Positive
- No certificate files to provision in any environment — the database is the single source of truth for all issuer configuration.
- Multi-branch issuer creation is a single API call: `sourceIssuerId` copies the encrypted columns from the source row, so no P12 re-upload or file duplication is needed.
- Certificate expiry and fingerprint are stored at upload time; they are available for monitoring queries without decrypting the private key.
- Issuer provisioning is atomic — the P12 parse, PEM storage, and API key creation happen in a single database write. There is no window where the path is stored but the file is missing.
- The plaintext P12 password is never persisted anywhere — it is used only to unlock the P12 in-process and then discarded.

### Negative
- The private key material now resides in the database in addition to (or instead of) a filesystem path. A database dump contains encrypted private key PEMs.
- The P12 file is held in RAM during the admin API request. For very large P12 files this is not a concern in practice, but it is a different memory profile than streaming.

### Mitigation
- The encrypted private key PEM is protected by AES-256-GCM keyed by `ENCRYPTION_KEY` (an environment variable). Exploiting a database dump alone is insufficient — the attacker also needs the `ENCRYPTION_KEY` from the server environment. This is the same threat model as the previous design (stolen DB + stolen env var).
- The admin API is protected by a separate 64-character hex secret (`ADMIN_SECRET`) and must be kept behind an internal firewall, never exposed on the public internet.
- Certificate rotation is handled by creating a new issuer row with the new P12; the old row can be set to `active = false` after the cutover.

### Alternatives Considered

- **Keep P12 on disk, fix provisioning with a CLI command**: A CLI wrapper around the seeder would make provisioning less manual but would not solve the multi-environment file-distribution problem or the multi-branch file-sharing problem. Rejected.
- **External secrets manager (HashiCorp Vault, AWS Secrets Manager)**: Would eliminate the encrypted-in-DB pattern entirely and centralise secret storage. The operational overhead of running and integrating a secrets manager is disproportionate to the current deployment context. Rejected for now; the `encrypted_private_key` column design is compatible with a future migration where the value is a Vault path rather than ciphertext.
- **Store only the P12 bytes encrypted in the DB**: Would avoid extracting PEM at upload time. The signer would need to decrypt the P12 bytes, parse the P12 on every signing call, and still handle the password separately. More complex than storing the extracted PEM, with no benefit. Rejected.
- **Environment variables per issuer**: Would work for a small fixed number of issuers but does not scale to dynamic issuer provisioning. Rejected.
