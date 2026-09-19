# ADR-034: Entry-Tier Feature Gating and a Reserved Frontend API Key/Webhook Pool

## Status
Accepted

## Date
2026-09-08

## Context

Ecuadorian invoicing competitors publish very cheap, very low-volume annual plans, and Comprobify already matches that shape with SOLO/LITE below STARTER (see `subscription-tiers.js`'s own comments). The risk of competing there is that tenants never have a reason to outgrow the cheap tiers — quota alone doesn't push an upgrade if a tenant's real volume never gets close to the cap.

Multi-branch and credit notes (`04`) were already gated to STARTER+/GROWTH+ respectively. Self-service API keys (`POST /v1/keys`) and webhook endpoints (`POST /v1/webhooks`) were not — every tier, including FREE, could mint its own keys and webhooks.

Separately, comprobify-web needs its own API keys to operate: CLAUDE.md's "Tenant-scoped API key permissions" section describes 5 dashboard roles that map 1:1 onto API scopes — each role the frontend renders needs its own scoped key, created via the same `POST /v1/keys` a tenant would call themselves. If those internal keys counted against a tenant's own `maxApiKeys`, a tenant on a low tier could have their entire key allotment consumed by the frontend before they ever created an integration key of their own.

## Decision

1. **FREE/SOLO/LITE now have `maxApiKeys: 0` and `maxWebhookEndpoints: 0`** (`subscription-tiers.js`). Self-service keys and webhooks become a STARTER+ feature, joining multi-branch and credit notes as capability-based upgrade triggers rather than relying on quota alone.

2. **A reserved, tier-independent allowance sits on top of every tier's own pool.** Two new config values, `RESERVED_FRONTEND_API_KEYS` (default 5) and `RESERVED_FRONTEND_WEBHOOKS` (default 1), are added to whatever `TIERS[tier].maxApiKeys`/`maxWebhookEndpoints` allows via two new helpers exported from `subscription-tiers.js`:

   ```js
   effectiveApiKeyLimit(tier)          // tier.maxApiKeys === null ? null : tier.maxApiKeys + RESERVED_API_KEYS_FOR_FRONTEND
   effectiveWebhookEndpointLimit(tier) // tier.maxWebhookEndpoints === null ? null : tier.maxWebhookEndpoints + RESERVED_WEBHOOK_ENDPOINTS_FOR_FRONTEND
   ```

   Every enforcement call site (`api-key.service.js`'s `createKey`, `admin.service.js`'s `createApiKey`, `webhook-endpoint.service.js`'s `create`) checks the effective limit, never the raw tier value. This means comprobify-web's own per-role keys never eat into what a tenant is actually entitled to create themselves — a STARTER tenant's advertised "5 keys" stays available in full even after the frontend has minted its own.

3. **`GET /v1/keys` and `GET /v1/webhooks` now return a `limit: { max, used }` block** computed from the same helpers, so a frontend or integrator can check remaining capacity without reimplementing the arithmetic. `GET /v1/tiers` gained a top-level `reservedForFrontend: { apiKeys, webhookEndpoints }` field alongside the existing per-tier `maxApiKeys`/`maxWebhookEndpoints` (which stay the raw, self-service-only numbers).

4. **Registration's own key mint is untouched.** `registration.service.js`'s `register()` and `recover()` call `apiKeyModel.create()` directly, not `apiKeyService.createKey()`, and always have — this was never gated by a tier cap and still isn't. Every tenant, on every tier including FREE, gets one fully-scoped ("Initial master key" / "Recovery key") working key the moment they register, with no dependency on `maxApiKeys` or the reserved pool. A tenant never needs to call `POST /v1/keys` at all to use the API directly.

## Consequences

### Positive
- Entry tiers (FREE/SOLO/LITE) now have a genuine capability reason to upgrade (self-service keys/webhooks), not just a quota one — same lever already proven for multi-branch/credit notes.
- comprobify-web's own operational usage (one key per dashboard role) is structurally incapable of starving a tenant's own allotment, on any tier.
- A tenant that never touches the dashboard — a pure API integrator — is unaffected: they still get one fully-working key at registration regardless of tier, and `effectiveApiKeyLimit`/`effectiveWebhookEndpointLimit` mean the low tiers still have *some* headroom (the reserved amount) even though their own advertised pool is 0.

### Negative / known limitation
- **The reserved allowance is additive, not partitioned.** Nothing tags a key as "one of comprobify-web's reserved slots" vs. "a tenant's own self-service key" — they're identical rows in `api_keys`. A technically inclined tenant on FREE/SOLO/LITE (`maxApiKeys: 0`) can still call `POST /v1/keys` directly, up to `RESERVED_API_KEYS_FOR_FRONTEND` (5) times, since the enforced ceiling (`0 + 5`) doesn't know whether the frontend has claimed any of that headroom yet. The same applies to webhooks (`0 + 1`). This means the "self-service keys are a paid feature" story isn't airtight against a direct API caller — accepted for now since it doesn't unlock anything of real value (scopes are already ALL_SCOPES-cloned from the registration key; document quota, branch limits, and credit-note eligibility are all enforced independently of key count).

### Alternatives Considered
- **Partition via a trusted-caller flag** — reuse the existing `INTERNAL_SERVICE_SECRET` trust boundary (`trusted-forwarded-ip.js`) so only requests from comprobify-web itself can mint a key that doesn't count against the tenant's own `maxApiKeys`, with a direct tenant call capped strictly at the raw tier value. Not implemented yet — closes the loophole above cleanly but adds a new trust dependency to a currently tenant-scoped, credential-only flow (ADR-013), and the loophole's practical impact is low. Revisit if entry-tier tenants are observed exploiting it, or if `keys:manage`/webhook self-service ever needs to be sold as a hard-gated paid add-on rather than a soft nudge.

## Addendum (2026-09-19): the "Negative / known limitation" loophole is closed (migration 102)

The "Alternatives Considered" partition-via-trusted-caller-flag option above is exactly what shipped, once "Free/Solo/Lite must never have API access" became a hard requirement rather than a soft nudge. `api_keys`/`webhook_endpoints` gained an `is_reserved` column (migration 102): every tenant-facing count/list (`countActiveByTenantId`, `findActiveByTenantId`'s default) now excludes reserved rows entirely, and `effectiveApiKeyLimit(tier)`/`effectiveWebhookEndpointLimit(tier)` are a plain passthrough of the tier's own value with no addition on top — `0` now means genuinely zero, not `0 + 5`. Reserved rows are minted only through `registration.service.js`'s `register()`/`recover()` (the account-lifecycle `X-Internal-Service-Secret` boundary, ADR-035) or the extended `ADMIN_SECRET`-gated admin endpoints (`POST /v1/admin/tenants/:id/api-keys`/`.../webhook-endpoints`, `isReserved`/`replaceKeyId`), never through the tenant-facing `POST /v1/keys`/`POST /v1/webhooks`. A tenant's own `revokeKey()`/webhook `update()`/`deregister()` treat a reserved row's id as not-found, so the tenant-facing surface can't even see it, let alone spend it.

Decision 2's `RESERVED_API_KEYS_FOR_FRONTEND`/`RESERVED_WEBHOOK_ENDPOINTS_FOR_FRONTEND` config values still exist, but repurposed — they're now a generous sanity ceiling on how many reserved rows a tenant can accumulate (bug/incident detection, `409 RESERVED_KEY_LIMIT_REACHED`), not a tenant-facing limit. `GET /v1/tiers` no longer publishes `reservedForFrontend`, since there's nothing left to explain — a tenant's `limit.max` is now their tier's own advertised number, exactly. See CLAUDE.md's "Entry-tier gating and reserved (comprobify-web-internal) keys/endpoints" for the full current design.
