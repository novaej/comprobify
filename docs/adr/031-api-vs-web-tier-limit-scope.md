# ADR-031: Classifying Tier Limits by Enforcement Scope (API vs WEB)

## Status
Accepted

## Date
2026-09-01

## Context

`TIERS` (`subscription-tiers.js`) had grown into a mix of two different kinds of billable cap without distinguishing them: things comprobify itself enforces at write-time (`maxBranches`, `maxIssuePointsPerBranch`, `maxWebhookEndpoints`, `documentQuota`, rate limits) and, implicitly, things it doesn't track at all. The trigger was a request to cap how many active team-member seats a tenant gets on the comprobify-web dashboard, per tier. comprobify has no user/session concept whatsoever — tenants are the account, the API key is the credential (see CLAUDE.md's "Tenant model") — so a seat count has no table here to check against; that data lives entirely in comprobify-web's own database.

A second gap surfaced alongside it: how many API keys a tenant can mint (`POST /v1/keys`) was never capped by tier at all, unlike every other per-tenant resource. Third-party integrators don't have "users" in Comprobify's sense — they authenticate with an API key, not a login — so a seat cap can never apply to them; the actual API-side lever for "how many distinct integrations/systems can access this tenant" is the number of live API keys, not a user count comprobify can't see.

## Decision

Two new tier caps, enforced by two different systems:

- **`maxApiKeys`** — a real, comprobify-enforced cap. `api-key.service.js`'s `createKey()` and `admin.service.js`'s `createApiKey()` both check `TIERS[tier].maxApiKeys` against `apiKeyModel.countActiveByTenantId()` before minting, the same shape as `maxBranches`/`maxWebhookEndpoints`. `402 API_KEY_LIMIT_REACHED` on breach.
- **`maxUsers`** — published, not enforced. comprobify has no users table, so this number exists in `TIERS` purely so comprobify-web has one source of truth to read (via `GET /v1/tiers`) instead of hardcoding its own copy of the ladder. comprobify never checks it.

Every key in a `TIERS[tier]` entry is now classified in `src/constants/tier-limit-scope.js`'s `TIER_LIMIT_SCOPE` map as `API` (comprobify owns enforcement) or `WEB` (comprobify-web owns enforcement; comprobify only publishes the number). `GET /v1/tiers` returns this map as `limitScopes` alongside the per-tier values, so the frontend can group "limits I need to enforce myself" apart from "limits the API already enforces for me" without hardcoding which keys are which — and so a future cap (e.g. a dashboard-only feature flag, or a new comprobify-owned resource) has one obvious place to declare who's responsible for it.

## Consequences

- A cap can be both published *and* meaningless to check against on the API side (`maxUsers`) — `limitScopes` exists specifically so that distinction is data, not tribal knowledge split across two repos.
- Every future addition to `TIERS[tier]` must get exactly one `TIER_LIMIT_SCOPE` entry, or `GET /v1/tiers` silently returns a cap with no declared owner. There's no enforced check for this (a missing entry doesn't throw) — a code reviewer has to catch it, same as `notification-catalog.js`'s "every `NotificationTypes` value needs a catalog entry" convention.
- `maxUsers` staying unenforced here means comprobify-web is fully responsible for keeping its own seat count in sync with what a tenant is entitled to; if comprobify-web ever needs a hard guarantee (not just its own trust), the seat concept would have to move into comprobify's own schema — out of scope for this ADR.
- The public API docs (`docs/site/getting-started.md`) only list `maxApiKeys` in the tier table, not `maxUsers` — a third-party integrator has no use for a dashboard seat count, and publishing it there would suggest it's something they can act on over the API, which it isn't.
