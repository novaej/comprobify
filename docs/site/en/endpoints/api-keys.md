# API Keys

Tenant-facing API key management. Mint named keys for each integration (frontend, ERP, mobile app, sandbox test rig, etc.), list them, and revoke leaked or unused ones.

```
GET    /v1/keys
POST   /v1/keys
DELETE /v1/keys/:id
GET    /v1/keys/:id/usage
```

## Authentication

`Authorization: Bearer <api-key>` — any active key for the tenant **with the `issuers:manage` scope**. Every endpoint on this page manages keys themselves, so a narrower key (e.g. a `documents:read`-only key) cannot list, create, revoke, or view usage for keys — otherwise a scoped-down key could mint itself a fresh full-access one. See [Scopes](#scopes) below.

---

## Scopes

Every key carries a `scopes` array. A request is only allowed through if the key's scopes include the scope the target route requires — see [Insufficient Scope](/errors/forbidden#insufficient_scope) for the error shape when it doesn't.

| Scope | Covers |
|---|---|
| `documents:write` | All document mutations (`POST /v1/documents`, `/send`, `/rebuild`, `/email-retry`, etc.) and `GET /:accessKey/authorize` (it triggers a live SRI call and can send an email, so it's treated like a write). Also `POST /v1/tenants/retry-failed-documents`. |
| `documents:read` | Every other `GET` under `/v1/documents` (list, get, RIDE, XML, events, credit notes, SRI responses, stats). |
| `issuers:manage` | The entire `/v1/issuers` router (branch creation, updates, document types, sequentials — reads and writes alike) **and** this entire `/v1/keys` router. |
| `account:manage` | `/v1/subscriptions`, `/v1/payments`, and `/v1/webhooks` in full, plus `PATCH /v1/tenants/language`, `POST /v1/tenants/promote`, and `POST /v1/tenants/agreements`. |

A key created without an explicit `scopes` field gets **all four** — full access, identical to how every key behaved before scopes existed. Scoping down is opt-in: pass `scopes` when minting a key (see [Mint a new key](#mint-a-new-key) below). Basic identity reads (`GET /v1/tenants/me`, `/agreements`, `/events`) and notification/catalog endpoints are scope-exempt — any active key can call them regardless of its `scopes` array.

---

## List keys

```
GET /v1/keys
```

Returns every active key for the tenant. The plaintext token is **never** returned — only labels, environments, and ids.

### Response

```json
{
  "ok": true,
  "keys": [
    {
      "id": "00000000-0000-0000-0000-000000000017",
      "label": "frontend-prod",
      "environment": "production",
      "scopes": ["documents:write", "documents:read", "issuers:manage", "account:manage"],
      "active": true,
      "createdAt": "2026-03-01T12:00:00.000Z",
      "revokedAt": null,
      "lastUsedAt": "2026-08-07T14:22:10.000Z",
      "requestCount": 15832
    },
    {
      "id": "00000000-0000-0000-0000-000000000018",
      "label": "dashboard-readonly",
      "environment": "production",
      "scopes": ["documents:read"],
      "active": true,
      "createdAt": "2026-04-12T09:30:00.000Z",
      "revokedAt": null,
      "lastUsedAt": null,
      "requestCount": 0
    }
  ]
}
```

`lastUsedAt` (nullable, `null` if the key has never authenticated a request) and `requestCount` (lifetime counter, not windowed — for time-boxed volume use the structured request logs or an APM tool) update on every request that key successfully authenticates. `scopes` reflects what that key is currently permitted to do — see [Scopes](#scopes) above.

### Errors

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `INSUFFICIENT_SCOPE` | The key making this request doesn't have the `issuers:manage` scope |

---

## Mint a new key

```
POST /v1/keys
```

Creates a new tenant-scoped key. The plaintext token is shown **once** in the response and never stored — record it immediately.

### Request body

```json
{
  "label": "dashboard-readonly",
  "environment": "sandbox",
  "scopes": ["documents:read"]
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `label` | string | No | `null` | Human-readable name for the integration (max 100 chars). Highly recommended for observability. |
| `environment` | string | No | `"sandbox"` | Either `"sandbox"` or `"production"`. Production keys can only be minted after the tenant has been promoted to production. |
| `scopes` | string[] | No | all 4 scopes (full access) | Non-empty array, each entry one of `documents:write`, `documents:read`, `issuers:manage`, `account:manage` — see [Scopes](#scopes) above. Omit entirely for a full-access key, identical to pre-scopes behavior. |

### Response

**201 Created**

```json
{
  "ok": true,
  "apiKey": "a3f8c2bd9e10...",
  "scopes": ["documents:read"]
}
```

The plaintext token (`apiKey`) is shown once; `scopes` echoes back what was actually granted (useful to confirm the default was applied when the field was omitted).

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `label` too long, `environment` invalid, or `scopes` is present but not a non-empty array of valid scope strings |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `FORBIDDEN` | Tenant email not verified, OR attempting to mint a production key before any issuer has been promoted |
| `403` | `INSUFFICIENT_SCOPE` | The key making this request doesn't have the `issuers:manage` scope |

---

## Revoke a key

```
DELETE /v1/keys/:id
```

Marks the key as inactive. The key cannot be used to authenticate any future request.

### Path parameters

| Parameter | Description |
|---|---|
| `id` | UUID of the key (from `GET /v1/keys`) |

### Response

**200 OK**

```json
{ "ok": true }
```

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `BAD_REQUEST` | Attempting to revoke the same key you are using to make this request — use a different key, or coordinate with admin support |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `INSUFFICIENT_SCOPE` | The key making this request doesn't have the `issuers:manage` scope |
| `404` | `NOT_FOUND` | Key id does not exist or already revoked, or belongs to a different tenant |

---

## Daily key usage

```
GET /v1/keys/:id/usage
```

Returns a daily series of authenticated requests for that key — meant to be fed directly into a chart (e.g. Chart.js, Recharts) without the frontend having to fill in gaps for idle days.

### Path parameters

| Parameter | Description |
|---|---|
| `id` | UUID of the key (from `GET /v1/keys`) |

### Query parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `days` | integer | No | `30` | How many days back to include (1–365), counting today. |

### Response

**200 OK**

```json
{
  "ok": true,
  "usage": [
    { "date": "2026-08-05", "requestCount": 0 },
    { "date": "2026-08-06", "requestCount": 128 },
    { "date": "2026-08-07", "requestCount": 342 }
  ]
}
```

The series is **zero-filled** — there are always exactly `days` entries, one per day in the range, even for days the key was never used. The id may belong to an already-revoked key (ownership, not `active` status, gates access), so a revoked key's history stays queryable.

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` is not a valid UUID, or `days` is outside the 1–365 range |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `INSUFFICIENT_SCOPE` | The key making this request doesn't have the `issuers:manage` scope |
| `404` | `NOT_FOUND` | Key id does not exist or belongs to a different tenant |

---

## Key environment + targeted issuer

When a key is used on a document request, the `resolveIssuer` middleware validates that the key's `environment` matches the targeted issuer's effective environment. The `sandbox` flag lives on the **tenant** — `resolveIssuer` reads `tenant.sandbox` and rejects any key/issuer mismatch:

| Key environment | Tenant `sandbox` | Result |
|---|---|---|
| `sandbox` | `true` | OK |
| `sandbox` | `false` | `401` — sandbox key cannot address a production tenant |
| `production` | `true` | `401` — production key cannot address a sandbox tenant |
| `production` | `false` | OK |

This is the only safeguard preventing accidental cross-environment requests; treat the environment as part of the key's identity, like Stripe's `sk_test_…` vs `sk_live_…` convention.
