# Getting Started

## Base URL

```
https://api.comprobify.com/v1
```

All examples on this site use paths relative to that base (e.g. `POST /v1/documents` means `POST https://api.comprobify.com/v1/documents`).

## Postman collection

Import the full collection to test every endpoint directly from Postman — all requests are pre-configured with variables for your base URL, API key, and access key.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/15935880-2sBXiqE8vL)

> **First time setup:** after importing, open the collection, go to **Variables**, and set `base_url` to `https://api.comprobify.com` and `api_key` to your API key. After creating an invoice, copy the returned `accessKey` into the `access_key` variable.

You can also download the collection JSON directly: [`comprobify.postman_collection.json`](https://raw.githubusercontent.com/novaej/comprobify/main/postman/comprobify.postman_collection.json)

---

## 1. Create your account (in the web app, not by API)

Account creation is not a third-party-callable endpoint — it happens in the **Comprobify web app**. Once you're done, your account already has an issuer and a fully-functional sandbox key, but, by design, the web app **never shows you its text**: it stores it encrypted and uses it internally to run your dashboard. That's fine if you're only going to use the dashboard; if you need to integrate your own system directly against the API, keep reading — section 3 below explains how to get a key you can actually copy.

The account starts on the **FREE** tier and all documents go to the SRI test environment until you go to production. See [Your account & the web app](account-lifecycle.md) for the details of registration and account recovery.

---

## 2. Verify your email

The web app sends you a verification email; click the link to activate your account. You can issue sandbox invoices right away without verifying, but verification is required before you can create branches, mint keys, register webhooks, start a subscription, or go to production. See [Your account & the web app](account-lifecycle.md#verifying-your-email).

---

## 3. Authenticate requests

Include your API key as a Bearer token on every document request:

```http
Authorization: Bearer <your-api-key>
```

The key is SHA-256 hashed on each request — the plaintext is never persisted after creation. If a key is compromised, contact support to revoke it and issue a new one.

> **What do I need to use the API directly?** The key your account got at sign-up (see section 1 above) already has every permission and covers all your branches — but the web app never shows you its text, it uses it internally to run your dashboard. To integrate your own system (a backend, a script, an ERP) you need a key you can copy, and the only way to get one is to mint a new one via `POST /v1/keys` from `/settings/api-keys` in the dashboard — that one *is* shown to you once, at creation. Minting keys this way (and registering your own webhooks via `POST /v1/webhooks`) are Starter-and-up features — see "Multiple named keys per tenant" below. **Free/Solo/Lite don't include direct API access** — your account's key is used only by the web app; to integrate your own system you need a Starter plan or higher.

---

## Understanding API keys and branches

This is the most important concept to understand before integrating.

**One API key covers your entire account (all branches).** API keys are **tenant-scoped**, not issuer-scoped. One key can address any of your branches; you declare the target branch via the `X-Issuer-Id` header on each request.

Your account (tenant) can have multiple issuers — each one is a unique pair of `branchCode` and `issuePointCode` (e.g., `001/001`, `001/002`, `002/001`). When you call `POST /v1/documents`, the API uses the key to identify your tenant, then uses `X-Issuer-Id` to determine:
- Which branch and issue point to embed in the document
- Which digital certificate to sign with
- Which sequential number sequence to draw from

### Listing your issuers

```http
GET /v1/issuers
Authorization: Bearer <your-api-key>
```

Returns every issuer (branch / issue point) under your tenant with its numeric `id`. Use that `id` as the `X-Issuer-Id` header value on document requests.

### Adding a new branch or issue point

Once your email is verified, call `POST /v1/issuers` with your API key:

```http
POST /v1/issuers
Authorization: Bearer <your-api-key>
Content-Type: multipart/form-data

branchCode=002
issuePointCode=001
```

The new issuer inherits your RUC, business name, and digital certificate from your tenant's first existing issuer (or pass `sourceIssuerId` to pick a specific one):

```json
{
  "ok": true,
  "issuer": { "id": "00000000-0000-0000-0000-000000000002", "branchCode": "002", "issuePointCode": "001", "sandbox": true }
}
```

No new API key is minted — the key you already have covers every branch under your tenant.

### Multiple named keys per tenant (Starter and up)

**Free/Solo/Lite cannot mint keys via self-service at all — not even one.** These tiers don't include direct API access: the initial key registration created is used only by the web app (see section 3 above), and to integrate your own system you need a Starter plan or higher. From Starter up, since one tenant-scoped key covers all your branches, you can mint named keys via `POST /v1/keys` (shown to you once, at creation) to track which integration is making each call (frontend, ERP, mobile app, etc.):

```http
POST /v1/keys
Authorization: Bearer <your-api-key>
Content-Type: application/json

{ "label": "ERP integration", "environment": "sandbox" }
```

Use `GET /v1/keys` to list them and `DELETE /v1/keys/:id` to revoke one. `environment` defaults to `sandbox`; minting a `production` key requires that the tenant has been promoted. All keys under the same tenant can address the same set of branches — the difference is observability (which integration made the call) and granular revocation (revoke a compromised integration without affecting others). `GET /v1/keys` already includes `lastUsedAt`/`requestCount` per key and a `limit: { max, used }` block showing how many more keys you can create, and [`GET /v1/keys/:id/usage`](endpoints/api-keys.md#daily-key-usage) returns a chart-ready daily series — handy for spotting a dormant key or an unexpected traffic spike.

### Key lifecycle

| Stage | Key environment | What to do |
|---|---|---|
| After registration | Sandbox | The web app uses it to run your dashboard right away; you don't need its text for that. |
| After going to production (from the web app) | Production | All sandbox keys are revoked and production mirrors are created — this happens inside the web app, which shows you the text of any named keys you created once (your account's internal key is never shown). |
| Adding your own integrations (Starter+) | Same tenant | Mint named keys via `POST /v1/keys` for per-integration observability. |
| Lost a named key (Starter+) | — | Mint a replacement via `POST /v1/keys`, revoke the old one via `DELETE /v1/keys/:id`. |

### Why tenant-scoped keys?

One key covers your whole account, so a frontend or ERP that operates on multiple branches doesn't have to juggle separate credentials. Per-integration accountability comes from named keys (`frontend-prod`, `erp`, `mobile`) rather than per-branch keys. Revoking a leaked key only affects the integration that used it; other keys keep working.

---

## 4. Register a webhook endpoint (recommended, Starter and up)

Register an HTTPS URL on your server to receive event notifications in near-real time — document authorizations, certificate alerts, and any future event types the API produces.

**Your own webhooks are a Starter-and-up feature** — Free/Solo/Lite cannot register an endpoint (see the tier table below). If you're on one of those plans, or you simply can't expose a public URL yet, use the polling approach at the end of this section instead — it works on every plan with no exceptions.

```http
POST /v1/webhooks
Authorization: Bearer <your-api-key>
Content-Type: application/json

{
  "url": "https://app.example.com/v1/comprobify/events",
  "eventTypes": ["DOCUMENT_AUTHORIZED", "CERT_EXPIRING", "CERT_EXPIRED"]
}
```

Response:

```json
{
  "ok": true,
  "endpoint": {
    "id": "00000000-0000-0000-0000-000000000001",
    "url": "https://app.example.com/v1/comprobify/events",
    "eventTypes": ["DOCUMENT_AUTHORIZED", "CERT_EXPIRING", "CERT_EXPIRED"],
    "active": true
  },
  "secret": "a3f5c8d1e2b4..."
}
```

**Store the `secret` immediately — it is shown only once.** Use it to verify the `X-Comprobify-Signature` header on every incoming request.

Omit `eventTypes` (or pass `[]`) to subscribe to all event types. You can register up to the limit for your plan (Free/Solo/Lite: 0 — not available; Starter: 2, Growth: 5, Business: 10, Enterprise: 20) and manage them via `GET / PATCH / DELETE /v1/webhooks`. `GET /v1/webhooks` includes a `limit: { max, used }` block so you can check your remaining headroom without guessing.

> **If you cannot expose a public HTTPS URL** (local development, behind a firewall), poll `GET /v1/notifications?sinceId=<lastId>` instead. Store the `id` of the most recent notification you received from each poll and pass it as `sinceId` on the next request to efficiently catch up — see [Notifications](endpoints/notifications.md).

---

## 5. Create an invoice

```http
POST /v1/documents
Authorization: Bearer <your-api-key>
X-Issuer-Id: <issuer-id>
Content-Type: application/json
Idempotency-Key: <unique-key>   (optional but recommended)

{
  "documentType": "01",
  "buyer": {
    "idType": "05",
    "id": "1234567890",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "items": [...],
  "payments": [...]
}
```

Every document endpoint (POST, GET, DELETE) requires the `X-Issuer-Id` header naming the target branch. Omit it → `400 ISSUER_ID_REQUIRED`. Pass an id belonging to another tenant → `403 ISSUER_FORBIDDEN`.

Returns the signed document with status `SIGNED`. See [Create Invoice](endpoints/create-invoice.md) for the full schema.

---

## 6. Send to SRI

```http
POST /v1/documents/:accessKey/send
```

Submits the signed XML to the SRI. The document moves to `RECEIVED` or `RETURNED`.

- **`RECEIVED`** — SRI accepted the document for processing. Proceed to step 7.
- **`RETURNED`** — SRI rejected the document (invalid data, schema error, etc.). Fix the issue and [rebuild](endpoints/rebuild-invoice.md) before resending.

---

## 7. Check authorization

```http
GET /v1/documents/:accessKey/authorize
```

Queries the SRI for the authorization result.

- **`AUTHORIZED`** — the invoice is legally valid. An email with the RIDE PDF and XML is sent to the buyer automatically.
- **`NOT_AUTHORIZED`** — SRI processed the document but did not authorize it. [Rebuild](endpoints/rebuild-invoice.md) with corrected data and resend.

---

## Going to production

Once you have verified your email, accepted the legal agreements, and tested your integration in sandbox, promotion to production is done from the **web app**, not by API. It's one-way: your sandbox keys are revoked, production equivalents are created (the web app shows you the text of the ones you created yourself **once only** — copy them then), and all subsequent documents for any branch go to the SRI production environment (`ambiente = 2`). See [Your account & the web app](account-lifecycle.md#going-to-production).

---

## Subscription tiers

Listed prices are the **tax-exclusive** rate (the "sticker price") — IVA (currently 15%) is added at checkout, never baked into the published figure. The parenthetical is the IVA-inclusive total, which is what you actually transfer.

| Tier | Price/mo (+ IVA) | Price/yr (+ IVA) | Document quota **(monthly base figure)** | Document types | Max branches | Max issue points per branch | Max webhook endpoints¹ | Max API keys¹ | Write limit |
|---|---|---|---|---|---|---|---|---|---|
| Free | $0 | — (monthly only) | 5 | Factura (`01`) | 1 | 1 | 0 | 0 | 10 req/min |
| Solo | — (yearly only) | $45 (+IVA $51.75) | 20 | Factura (`01`) | 1 | 1 | 0 | 0 | 15 req/min |
| Lite | $12 (+IVA $13.80) | $120 (+IVA $138) | 50 | Factura (`01`) | 1 | 1 | 0 | 0 | 30 req/min |
| Starter | $20 (+IVA $23) | $200 (+IVA $230) | 200 | Factura (`01`) | 3 | 2 | 2 | 5 | 60 req/min |
| Growth | $90 (+IVA $103.50) | $900 (+IVA $1,035) | 1,000 | Factura, Nota de Crédito (`01`, `04`) | 10 | 5 | 5 | 10 | 120 req/min |
| Business | $230 (+IVA $264.50) | $2,300 (+IVA $2,645) | 4,000 | Factura, Nota de Crédito (`01`, `04`) | Unlimited | Unlimited | 10 | 20 | 300 req/min |
| Enterprise | $450 (+IVA $517.50) | $4,500 (+IVA $5,175) | **Unlimited** | Factura, Nota de Crédito (`01`, `04`) | Unlimited | Unlimited | 20 | Unlimited | 600 req/min |

**Free is monthly-only** — it's never actually purchased (there's no subscription behind it), so there's no annual variant to switch to. **Solo is yearly-only** (no monthly billing on that plan) — a low-cost annual commitment below Starter, meant as the entry rung. **Enterprise has no document quota at all**: it's genuinely unlimited (not a large number), and has no overage rate either, since there's no cap to ever overage past.

¹ **On Free/Solo/Lite, "0" means the plan doesn't include direct API access.** These two columns are how many keys/webhooks you can create yourself — minting keys and registering your own webhooks are Starter-and-up features. Your initial key from registration exists and works, but the web app never shows you its text (it uses it internally to run your dashboard), so those tiers don't include direct API access — to integrate your own system, upgrade to Starter or higher. See the "What do I need to use the API directly?" note in section 3.

> **Note:** these prices reflect the currently published catalog and can change — any price change requires at least 30 days' notice to active tenants (see [Your subscription & billing](paying-your-subscription.md)), so a price never changes overnight. Always check the Comprobify web app for the live catalog; this table is a reference and can fall out of date between edits to this page.

**Yearly billing changes more than just how often you pay — it changes how your quota is consumed too.** On a **monthly** plan, the table's quota figure is your cap and resets every month. On a **yearly** plan, that same figure is multiplied by 12 and granted up front for the whole year — you can consume it unevenly (e.g. 0 documents in January, 480 in December on a plan with a 40/month quota) instead of losing whatever you didn't use each month.

The document quota is shared across all branches and document types, and counts **production documents only** — sandbox/test documents never consume it. When you reach it, `POST /v1/documents` returns `402 QUOTA_EXCEEDED`. See "Upgrading to a paid plan" below.

> **Monthly or yearly, depending on how you pay.** On monthly billing, your quota resets at the start of each billing month. On yearly billing, your quota is a single pool for the full 12 months (monthly figure × 12), consumable evenly or unevenly across the whole year — it does not reset every month. The **Enterprise** tier has no quota at all: it's unlimited. Only production documents count against it.

### Upgrading to a paid plan

**Billing is handled in the Comprobify web app, not over the API.** You pick a tier there and pay by card (active within seconds) or by bank transfer (your provider reviews the proof, then it activates). There are no endpoints to integrate for any of it.

See [Your subscription & billing](paying-your-subscription.md) for the full walkthrough: the two payment methods, renewals and the grace period, changing tier, cancelling, [extra user seats](paying-your-subscription.md#extra-user-seats), and the 30-day price-change notice.

What you *can* do over the API is track the outcome:

- [`GET /v1/tenants/me`](endpoints/tenant-me.md) — your current tier, quota, extra seats, and account status. `subscriptionTier`/`documentQuota` update the moment a payment is verified.
- [Notifications](endpoints/notifications.md) — `PAYMENT_VERIFIED`, `PAYMENT_REJECTED`, `SUBSCRIPTION_RENEWAL_DUE`, `SUBSCRIPTION_EXPIRED` and more, fanned out to your [webhooks](endpoints/webhooks.md) if you've registered any. No polling needed.
- The Comprobify web app — current plans and pricing are checked there; there's no equivalent public endpoint intended for external integrators.

Until a payment is verified you're on FREE limits in production — nothing is blocked, you just don't have the higher quota yet.

Attempting to create a branch beyond the tier limit returns `402 BRANCH_LIMIT_REACHED` / `ISSUE_POINT_LIMIT_REACHED`. Attempting to enable a document type your plan doesn't include (e.g. credit notes on Free/Starter) returns `402 DOCUMENT_TYPE_NOT_IN_TIER` — see [Issuer Document Types](endpoints/document-types.md).

---

## Idempotency

`POST /v1/documents` accepts an optional `Idempotency-Key` header. If you retry the same request after a timeout, send the same key — the API returns the existing document instead of creating a duplicate. Use a unique key per intended invoice (e.g. a UUID), and keep it consistent across retries.

---

## Rate Limiting

Requests are rate-limited per API key based on your subscription tier (see table above). When you exceed the limit, the API returns [`429 Too Many Requests`](errors/too-many-requests.md). Implement exponential backoff: wait 1s, then 2s, then 4s before retrying.

---

## Document statuses

| Status | Meaning | Next step |
|---|---|---|
| `SIGNED` | Created and signed, not yet sent to SRI | Send to SRI |
| `RECEIVED` | Accepted by SRI for processing | Check authorization |
| `RETURNED` | SRI rejected the document | Rebuild and resend |
| `AUTHORIZED` | SRI authorized — legally valid | Done |
| `NOT_AUTHORIZED` | SRI did not authorize | Rebuild and resend |
