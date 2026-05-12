# ADR-013: Tenant-Scoped API Keys with Per-Request Issuer Header

## Status
Accepted

## Date
2026-05-11

## Context

ADR-007 introduced API keys where each key was tied to a single issuer. A tenant with N branches (multiple issuance points under one RUC) was forced to issue and rotate N keys — one per `(branch_code, issue_point_code)` pair. As the product grew into a true multi-tenant SaaS with self-service registration, three pain points emerged:

1. **Bad ergonomics for clients.** A frontend dashboard or an ERP integration that operates on behalf of all of a company's branches had to juggle N keys and route requests by branch. There was no concept of "the company's key" — only "this branch's key."
2. **Mixed concerns in one credential.** A key simultaneously identified *who* the caller is (the tenant), *which integration* it represents, and *which branch* the request targets. These are three orthogonal axes that should be expressable independently.
3. **Weak observability.** Multiple branches behind one customer all looked like separate principals at the API edge, and a single integration (e.g. an ERP) couldn't be tracked end-to-end across branches.

Industry norm (Stripe, Twilio, Plaid) is to mint keys at the account / tenant level and pass the target resource as a request parameter.

## Decision

API keys are tenant-scoped. The target issuer is supplied per-request via an HTTP header.

### Schema
```
api_keys
 ├── id
 ├── tenant_id      (was: issuer_id)
 ├── key_hash
 ├── label
 ├── environment    (sandbox | production)
 ├── active
 └── created_at / revoked_at
```

### Auth flow
1. `authenticate` middleware: SHA-256 of the Bearer token → join `api_keys` × `tenants` → sets `req.tenant`, `req.apiKey`, `req.keyHash`. No issuer resolved.
2. `resolveIssuer` middleware (mounted on `/api/documents/*`): reads `X-Issuer-Id` header, fetches the issuer, validates `issuer.tenant_id === req.tenant.id` (else 403), validates `req.apiKey.environment === (issuer.sandbox ? 'sandbox' : 'production')` (else 401), sets `req.issuer`.
3. Issuer-management routes (`/api/issuers/:id/...`) bypass `resolveIssuer` and instead read the issuer from `:id` in the URL with the same ownership check inline in the controller.

### Request contract
```
POST /api/documents
Authorization: Bearer cmp_xxx
X-Issuer-Id: 42
Idempotency-Key: abc-123
```
Missing header → `400 ISSUER_ID_REQUIRED`. Foreign issuer → `403 ISSUER_FORBIDDEN`. Env mismatch → `401`.

### Multi-key model
Tenants can mint multiple named keys (e.g. `frontend-prod`, `erp`, `mobile-app`) via `GET / POST / DELETE /api/keys`. The `label` field is purely for human observability. Each key carries an `environment` (sandbox or production) stamped at creation; production keys can only be minted after the tenant has promoted at least one issuer to production.

## Consequences

### Positive
- **Cleaner client integrations.** A frontend covering 5 branches uses one key and one issuer dropdown — no key juggling.
- **Independent observability axes.** `api_key_id` answers "which integration" (ERP vs frontend vs mobile); `issuer_id` answers "which branch." Slice traffic on either dimension independently.
- **Smaller blast radius for revocation.** Compromising the ERP's key doesn't force rotation on the frontend's key. Both belong to the same tenant.
- **Aligns with industry conventions.** Mirrors Stripe's `Stripe-Account` header pattern: one credential, one explicit target resource.
- **Removes implicit state.** "The current issuer" no longer exists as an implicit fact derived from the key. Every request states its target explicitly.

### Negative
- **Hard breaking change.** Every existing integration must add the `X-Issuer-Id` header. Clients that previously sent only `Authorization` now get `400`. (Acceptable: project still in early adoption; the migration cost is bounded.)
- **Lost a built-in safety check.** Previously a sandbox key physically couldn't address a production issuer because the key *was* the issuer. Now the same property is enforced by `resolveIssuer` at the middleware layer — equivalent in practice but moves the check out of the schema.
- **Extra request parsing.** Every authenticated request reads + validates two headers instead of one.

### Mitigation
- The hard break is sequenced before any production-tier customer onboarding; a graceful fallback (e.g. "default issuer on the key") was rejected because it would force the schema to keep `issuer_id` as a transitional column and double the auth code paths indefinitely.
- The env-mismatch check sits in `resolveIssuer` and is unit-tested (see `tests/unit/middleware/resolve-issuer.test.js`) — defence in depth equivalent to the previous schema-level invariant.
- The previous policy on `api_keys` (RLS by `issuer_id`) was dropped along with the column. The model now filters explicitly by `tenant_id` in every query; reintroducing a tenant-scoped RLS policy is captured under future work in `NEXT_STEPS.md` as a defence-in-depth follow-up.

### Alternatives Considered
- **Keep `api_keys.issuer_id` as a nullable "default issuer" for backward compatibility.** Rejected — it preserves the implicit state we are trying to remove and keeps two code paths alive forever.
- **Pass `issuerId` in the request body.** Rejected — does not work for GETs (would need a query parameter, creating inconsistency); pollutes the document schema with infrastructure metadata.
- **Auth-time selection (header set on key creation, immutable).** Rejected — defeats the point of allowing one key to address multiple branches.
- **Move to scopes-as-permission and let the scope encode the issuer.** Rejected — scopes are about *what the key can do*, not *what it operates on*. Conflating them breaks both abstractions.
