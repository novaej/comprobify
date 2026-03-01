# ADR-007: API Key Authentication

## Status
Accepted

## Date
2026-03-01

## Context

The system started as single-tenant: one hardcoded `issuerModel.findFirst()` call in `document.service.js` loaded the only issuer configuration in the database. As the system evolved into a Tax Core microservice meant to serve multiple clients — each with their own RUC, certificate, SRI environment, and sequential counters — it needed a proper authentication mechanism that also identified which issuer the caller represents.

Two requirements had to be satisfied simultaneously:

1. **Authentication** — reject unauthenticated requests before any route handler runs.
2. **Issuer resolution** — identify the caller's issuer configuration so that document services no longer call `issuerModel.findFirst()` but instead use the authenticated issuer.

## Decision

Bearer API key authentication:

- Caller sends `Authorization: Bearer <token>` on every request.
- Token is a 256-bit (32-byte) cryptographically random string, hex-encoded to 64 characters.
- The server computes `SHA-256(token)` and looks up `key_hash` in the `api_keys` table.
- The `api_keys` row JOINs `issuers` — the lookup returns the full issuer configuration in one query.
- The result is attached to `req.issuer` by the `authenticate` middleware.
- An invalid or missing key returns `AppError(401)` before any route handler runs.

**Why SHA-256 and not bcrypt/argon2:**

API keys are 256-bit random strings — not user-chosen passwords. Passwords need bcrypt/argon2 because they are guessable and short; the intentional slowness protects against dictionary attacks on a stolen hash table. A 256-bit random token has 2^256 possible values — brute-force is computationally infeasible regardless of hash speed. SHA-256 is appropriate and adds no perceptible latency to each request.

## Consequences

### Positive
- Zero client complexity: one static token, one header.
- Revocation is instant: set `active = false` or set `revoked_at` — no token blacklist propagation required.
- Issuer configuration is loaded in the same query that authenticates the caller — no extra DB round-trip.
- The plaintext token is never stored — the SHA-256 hash in the DB means a DB breach does not expose usable tokens.

### Negative
- No built-in expiry — keys are long-lived unless manually revoked.
- No scopes or permissions per key — each key grants full access to its issuer's documents.
- Token rotation requires the caller to update their configuration.

### Mitigation
- Long-lived keys are acceptable for server-to-server integrations in a controlled deployment environment.
- Rotation is straightforward: create a new key, update the caller's configuration, revoke the old key by setting `active = false`.
- Future fine-grained access control can be added by introducing a `scopes` column on the `api_keys` table without changing the authentication mechanism.

### Alternatives Considered
- **JWT**: Would add key pair or shared-secret management, token expiry and refresh logic, base64-encoded payload overhead, and clock-skew handling. JWT's statelessness advantage is irrelevant when the server already queries the DB on every request. Rejected in favour of simpler API keys.
- **HTTP Basic Auth**: Designed for human credentials (username + password). Encodes credentials in every request header without being more secure than a Bearer token, and HTTP library support for this pattern is weaker than for Bearer tokens. Rejected.
- **OAuth 2.0 Client Credentials**: OAuth is designed for delegated authorisation — a user granting a third-party app access to their resources. This system is a server-to-server integration where the caller and the resource owner are the same entity. OAuth would require running a separate authorisation server, adding unnecessary complexity. Rejected.
- **mTLS (mutual TLS)**: Very strong security guarantee but requires certificate management on the client side and TLS termination configuration on the server side. Too operationally heavy for the current deployment context. Rejected.
