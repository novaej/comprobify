# ADR-040: MCP Access Uses a Reserved Read-Only Key, Not OAuth Tokens at the API

## Status
Accepted

## Date
2026-10-07

## Context

We are building a first-party, hosted MCP server so a tenant's users can query their own Comprobify data from an AI assistant (Claude and similar clients). MCP requires the user to authorize the connection through OAuth 2.1 (authorization code + PKCE); the user must never hand their password or an API key to the assistant.

The original request was for this API to accept OAuth access tokens directly. Two existing decisions made that awkward:

- **The API has no user accounts.** Tenants have no password or session here; the API key is the credential. Sign-in, users, and roles exist only in comprobify-web, so the login and consent step could only ever live there.
- **ADR-034 (as tightened by migration 102):** FREE/SOLO/LITE tenants must never hold a credential that can call the API directly. An OAuth token the API accepts is exactly that.

Because the MCP server is ours, not a third party's, neither problem has to be solved at the API.

## Decision

1. **The API does not accept OAuth tokens and gains no OAuth endpoints.** `authenticate` is unchanged: a bearer token is still only ever an API key.
2. **comprobify-web is the OAuth authorization server.** It owns login, consent, token issuance, refresh, revocation, and client registration. The access token an MCP client holds is valid only at the MCP server.
3. **The MCP server calls this API with a reserved key**, one per tenant, minted by comprobify-web through the existing `POST /v1/admin/tenants/:id/api-keys` (`isReserved: true`), the same path it already uses for its per-role keys.
4. **That key is read-only:** scopes `documents:read` and `issuers:read`. The MCP server only makes `GET` calls for now. `GET /:accessKey/authorize` stays out of reach, since it requires `documents:write`.
5. **MCP access is available on every tier**, including FREE/SOLO/LITE. This is consistent with ADR-034, not an exception to it: the tenant never sees the key, cannot list or revoke it through `/v1/keys`, and gets a fixed set of read tools rather than API access. It is the same trust model as the dashboard.
6. **The reserved-key sanity ceiling rises from 5 to 6** (`RESERVED_FRONTEND_API_KEYS`) to make room for the MCP key alongside the master and per-role keys.

## Consequences

**Positive**
- No new authentication path, tables, or attack surface in this API.
- Scopes, rate limiting, usage tracking, suspension gates, and request logging all apply to MCP traffic unchanged, since it arrives as an ordinary key.
- ADR-035's gate still fences off billing, promotion, agreements, and account lifecycle from anything the MCP server could do.

**Negative / things to keep in mind**
- **The key can be rotated out from under the MCP server.** Promotion revokes every sandbox key and mirrors them into production; `recover()` revokes every key in the environment and recreates only one, so the MCP key does not survive a recovery. The API stores only a hash, so a lost plaintext cannot be fetched again. comprobify-web must treat the key as re-mintable: capture it from the promote response, and mint a fresh one whenever it is missing or the API rejects it with `401`.
- **Reserved no longer means "used by comprobify-web's own BFF only."** A reserved key now also backs a second first-party service. Anything that assumes otherwise (e.g. the `callerIsReserved` reasoning in `promote()`) should be read with that in mind; the MCP key holds no scope that can reach those routes.
- **Adding write tools later reopens the tier question.** Creating documents through MCP on an entry tier would erode ADR-034's upgrade-by-capability lever. If writes are added, gate them by tier in the MCP server and revisit this ADR.
- **A third-party integration is still unsupported.** This design works only because we operate the MCP server. Letting an outside service act for a tenant would need the API to accept delegated tokens after all, which is a separate decision.
