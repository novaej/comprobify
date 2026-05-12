# ADR-014: Tenant-Level Environment (sandbox vs production)

**Status:** Accepted  
**Date:** 2026-05-12

---

## Context

Prior to this ADR, each issuer row had its own `sandbox` boolean column. This created a mixed state where some branches of the same RUC could be in production while others remained in sandbox — a state that is impossible to explain to a non-technical user and inconsistent with how SRI works (authorization is per-RUC, not per-branch).

ADR-013 already moved API keys to the tenant level. The logical next step was to make environment a tenant-level concept as well, since a tenant IS their RUC — a single legal entity that is either authorized by SRI for production or not.

---

## Decision

1. **`tenants.sandbox` (boolean, default `true`)** is the single source of truth for environment. The `issuers.sandbox` column is dropped (migration 043).

2. **`issuer.sandbox` in service code is a virtual field.** `resolveIssuer` middleware sets `req.issuer.sandbox = req.tenant.sandbox` after fetching the issuer, so all downstream document services can continue to read `issuer.sandbox` without change.

3. **Promotion is tenant-level.** `POST /api/tenants/promote` flips `tenants.sandbox = false`, seeds production sequentials for all issuers × document types, revokes all sandbox API keys, and creates matching production keys — one per revoked sandbox key, preserving the label (key mirroring).

4. **Key mirroring.** Because tenants may have multiple named keys (e.g. `frontend-prod`, `erp`, `mobile-app`), the promote response returns all new production tokens. The caller must distribute them. Tokens are shown once — if lost, the tenant must mint new keys via `POST /api/keys`.

5. **Admin override.** `POST /api/admin/tenants/:id/promote` performs the same operation but skips the ACTIVE status check, matching the pattern of other admin overrides.

---

## Consequences

**Positive:**
- No more mixed sandbox/production state within a single RUC.
- Simpler `resolveIssuer` check: `req.tenant.sandbox` vs `req.apiKey.environment` — no issuer DB column needed.
- Promotion UX: tenants go live in one action and their key setup is preserved (same label count and names).
- New branches created after promotion automatically operate in production (no per-branch promote step).

**Negative / Trade-offs:**
- Per-branch gradual rollout is no longer possible. A tenant cannot promote one branch while keeping another in sandbox.
- The promote response returns an array of tokens rather than a single token — callers must handle multiple values.

---

## Alternatives Considered

**Keep per-issuer sandbox flag** — rejected because it allows the mixed state that motivated this change, and because ADR-013's tenant-scoped keys already make per-issuer environment largely meaningless (a sandbox key can't be validated against a production issuer).

**Add `tenants.environment` string field** — rejected in favor of the simpler boolean `sandbox`. The binary nature of the choice (sandbox or production) doesn't benefit from an enum.
