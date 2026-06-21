# API Keys

Tenant-facing API key management. Mint named keys for each integration (frontend, ERP, mobile app, sandbox test rig, etc.), list them, and revoke leaked or unused ones.

```
GET    /v1/keys
POST   /v1/keys
DELETE /v1/keys/:id
```

## Authentication

`Authorization: Bearer <api-key>` — any active key for the tenant.

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
      "id": 17,
      "label": "frontend-prod",
      "environment": "production",
      "active": true,
      "createdAt": "2026-03-01T12:00:00.000Z",
      "revokedAt": null
    },
    {
      "id": 18,
      "label": "erp-integration",
      "environment": "production",
      "active": true,
      "createdAt": "2026-04-12T09:30:00.000Z",
      "revokedAt": null
    }
  ]
}
```

---

## Mint a new key

```
POST /v1/keys
```

Creates a new tenant-scoped key. The plaintext token is shown **once** in the response and never stored — record it immediately.

### Request body

```json
{
  "label": "mobile-app",
  "environment": "sandbox"
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `label` | string | No | `null` | Human-readable name for the integration (max 100 chars). Highly recommended for observability. |
| `environment` | string | No | `"sandbox"` | Either `"sandbox"` or `"production"`. Production keys can only be minted after the tenant has been promoted to production. |

### Response

**201 Created**

```json
{
  "ok": true,
  "apiKey": "a3f8c2bd9e10..."
}
```

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `label` too long or `environment` invalid |
| `401` | `UNAUTHORIZED` | Missing or invalid API key |
| `403` | `FORBIDDEN` | Tenant email not verified, OR attempting to mint a production key before any issuer has been promoted |

---

## Revoke a key

```
DELETE /v1/keys/:id
```

Marks the key as inactive. The key cannot be used to authenticate any future request.

### Path parameters

| Parameter | Description |
|---|---|
| `id` | Numeric id of the key (from `GET /v1/keys`) |

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
| `404` | `NOT_FOUND` | Key id does not exist or already revoked, or belongs to a different tenant |

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
