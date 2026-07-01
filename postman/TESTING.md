# Comprobify API — Testing Guide

Two Postman collections cover both sides of the system:

| Collection | Who runs it | File |
|---|---|---|
| `comprobify.postman_collection.json` | Developer / tenant integrating the API | Developer flow below |
| `comprobify-internal.postman_collection.json` | Operator running the platform | Admin flow below |

Requests marked **✓** in the collections have test scripts that automatically capture response values (API key, IDs, etc.) into collection variables — no manual copy-paste needed for those steps.

---

## Setup

Import both collections into Postman. Set these **collection variables** before running anything:

### Developer collection

| Variable | Where to get it |
|---|---|
| `base_url` | Your API URL — e.g. `https://your-api.onrender.com` or `http://localhost:8080` |
| `admin_secret` | `ADMIN_SECRET` env var value (needed for the pre-flight admin legal doc publish step) |

Everything else (`api_key`, `issuer_id`, `access_key`, etc.) is auto-captured by test scripts.

### Admin / internal collection

| Variable | Where to get it |
|---|---|
| `base_url` | Same API URL |
| `admin_secret` | `ADMIN_SECRET` env var value |

---

## Flow A — Developer (Tenant)

### Pre-flight: publish legal documents (admin only, one time per version)

> Run these before any tenant registers for the first time, or whenever the legal text
> changes and you want existing tenants to re-accept. If documents are already published,
> skip straight to step 1.

Run from the **Admin** folder of the **internal** collection:

1. **Publish Legal Document (TERMS)** — `POST /v1/admin/legal-documents` body: `{ "documentType": "TERMS", "version": "2026-07-01" }`
2. **Publish Legal Document (PRIVACY)** — same, `"documentType": "PRIVACY"`
3. **Publish Legal Document (DPA)** — same, `"documentType": "DPA"`

**No markdown content in the body.** The server reads directly from `docs/legal/terminos-de-servicio.md`, `docs/legal/politica-de-privacidad.md`, and `docs/legal/acuerdo-procesamiento-datos.md` on the filesystem. Make sure those files are present and correct before publishing.

Use the same `version` string for all three types published together — this is the "bundle version" tenants must accept.

✓ Postman test script captures `legal_version` from the TERMS publish response.

---

### Step 1 — Discover current legal documents

**`GET /v1/legal/documents`** *(Legal Documents folder)*

✓ Test script captures `legal_version` from the `TERMS` entry.

You should see a response like:
```json
{
  "documents": [
    { "documentType": "TERMS", "version": "2026-07-01", "url": "/v1/legal/documents/TERMS" },
    { "documentType": "PRIVACY", "version": "2026-07-01", "url": "/v1/legal/documents/PRIVACY" },
    { "documentType": "DPA", "version": "2026-07-01", "url": "/v1/legal/documents/DPA" }
  ]
}
```

Optionally fetch **`GET /v1/legal/documents/TERMS`** to preview the rendered HTML that would appear in a signup modal.

---

### Step 2 — Check tiers (optional)

**`GET /v1/tiers`** *(Tiers folder)*

Review available plans and pricing before registering.

---

### Step 3 — Register

**`POST /v1/register`** *(Registration folder)*

Fill in the form-data fields before sending:

| Field | Value |
|---|---|
| `cert` | Select your `.p12` certificate file |
| `certPassword` | Certificate password (leave blank if none) |
| `email` | A real email you can access (needed for verification) |
| `ruc` | 13-digit RUC |
| `businessName` | Your company name |
| `branchCode` | `001` |
| `issuePointCode` | `001` |
| `emissionType` | `1` |
| `requiredAccounting` | `false` |
| `termsVersion` | Auto-filled from `{{legal_version}}` captured in Step 1 |

✓ Test script captures: `api_key`, `tenant_id`, `issuer_id`.

> **Important:** The API key shown in the response is shown **once only**. The test script saves it
> to `api_key` collection variable automatically. Keep the Postman console open to see it.

---

### Step 4 — Verify email

Check your inbox for a verification email. Extract the `token` from the link:

```
https://your-api.com/v1/verify-email?token=<64-char-hex>
```

Set `verification_token` collection variable manually, then run:

**`GET /v1/verify-email?token={{verification_token}}`** *(Registration folder)*

This activates the tenant. Without verification you can use sandbox but cannot promote to production.

---

### Step 5 — Confirm account status

**`GET /v1/tenants/me`** *(Tenants folder)*

✓ Test script re-captures `tenant_id` and logs `legalVersion`.

Expected: `status: ACTIVE`, `sandbox: true`, `subscriptionTier: FREE`, `legalAcceptedAt` set.

---

### Step 5a — View your personalized legal documents

After registration the server fires-and-forget generates three personalized document instances (TERMS, PRIVACY, DPA) with your business name and RUC substituted in.

**`GET /v1/tenants/legal-documents`** *(Tenants folder)*

Expected: three rows, all `status: PENDING` (registration generates but does not automatically accept).

**`GET /v1/tenants/legal-documents/TERMS`** *(Tenants folder)*

Returns your personalized Terms of Service as HTML — a yellow disclaimer notice is prepended. The DPA will show your actual `businessName` and `ruc` substituted in.

**`GET /v1/tenants/legal-documents/DPA`**

Confirm your business name and RUC appear correctly in the intro paragraph.

---

### Step 5b — Accept all legal documents

**`POST /v1/tenants/accept-legal`** *(Tenants folder)*

```json
{ "termsVersion": "{{legal_version}}" }
```

Accepts all PENDING instances at once (TERMS, PRIVACY, DPA), recording IP address and user agent.

Expected: `{ "ok": true }` — all three rows flip to `status: ACCEPTED`.

---

### Step 6 — Verify legal acceptance status

**`GET /v1/tenants/legal-status`** *(Tenants folder)*

Expected: `needsAcceptance: false`, `outdated: []` — all documents accepted.

> **If `needsAcceptance: true`:** The `outdated` array lists which types need acceptance and includes a `url` for each. Fetch `GET /v1/tenants/legal-documents/:type` to show the document, then call `POST /v1/tenants/accept-legal` again.

> **Third-party integrators** should poll `GET /v1/tenants/legal-status` periodically. When the admin publishes a new template version, calling this endpoint automatically generates new PENDING instances, which surfaces as `needsAcceptance: true` until the tenant re-accepts.

---

### Step 7 — Confirm issuer

**`GET /v1/issuers`** *(Issuers folder)*

✓ Test script re-captures `issuer_id` from the first issuer. Confirm your RUC and branch details.

---

### Step 8 — Create an invoice (sandbox)

**`POST /v1/documents`** → *Create Invoice* *(Documents folder)*

The request body includes a complete sample invoice. Set `X-Issuer-Id: {{issuer_id}}` (already in the header). Edit the buyer RUC, items, and totals as needed.

✓ Test script captures `access_key`.

---

### Step 9 — Send to SRI (sandbox)

**`POST /v1/documents/{{access_key}}/send`** *(Documents folder)*

✓ Test script asserts status is `RECEIVED` or `RETURNED`.

---

### Step 10 — Check authorization

**`GET /v1/documents/{{access_key}}/authorize`** *(Documents folder)*

✓ Test script logs the current document status.

Expected in sandbox: `AUTHORIZED` (SRI test environment typically authorizes within seconds).
If `RETURNED` or `NOT_AUTHORIZED`, check `GET /v1/documents/{{access_key}}/events` for the SRI rejection message, fix the data, and use **Rebuild Invoice**.

---

### Step 11 — Download outputs

| Request | What you get |
|---|---|
| `GET /v1/documents/{{access_key}}/ride` | RIDE PDF (save to file) |
| `GET /v1/documents/{{access_key}}/xml` | Signed XML |
| `GET /v1/documents/{{access_key}}/events` | Full audit trail |

---

### Step 12 — Subscribe to a paid tier

**`POST /v1/subscriptions`** *(Subscriptions folder)*

```json
{ "tier": "STARTER", "billingInterval": "MONTHLY" }
```

✓ Test script captures `subscription_id` and `payment_id`.

Response includes `bankTransfer` instructions. The subscription stays `PENDING_PAYMENT` until proof is uploaded and the operator self-bills a real invoice.

---

### Step 13 — Upload payment proof

**`PATCH /v1/payments/{{payment_id}}/proof`** *(Payments folder)*

Attach a screenshot or PDF of the bank transfer confirmation as the `proof` file field.

---

### Step 14 — Promote to production

> **Prerequisites before calling promote:**
> 1. Email must be verified (status ACTIVE — see Step 4)
> 2. All legal documents must be ACCEPTED (see Step 5b) — promotion returns `403 LEGAL_ACCEPTANCE_REQUIRED` if not
> 3. Complete the subscription payment cycle (Steps 12–13 + admin review in Flow B) OR promote on FREE tier and subscribe afterward

**`POST /v1/tenants/promote`** *(Tenants folder)*

✓ Test script captures new production `api_key` and logs all returned keys.

> **Critical:** Production API keys are shown **once** here. Save them immediately. The test script
> sets the first key as `api_key` — if you minted multiple keys, copy the others from the
> Postman console.

After promotion, `sandbox` becomes `false`. Use the production `api_key` going forward.

---

### Step 15 — Issue a production invoice

Repeat Steps 8–11 with the production `api_key`. The invoice now goes to SRI's production environment and has real fiscal validity.

---

### Step 16 — Manage API keys

| Request | What it does |
|---|---|
| `GET /v1/keys` | List all active keys |
| `POST /v1/keys` | ✓ Mint a named key (`label: "erp"`) — captures `api_key_id` |
| `DELETE /v1/keys/{{api_key_id}}` | Revoke a key |

---

### Step 17 — Notifications and webhooks

**`GET /v1/notifications`** — poll for cert alerts and document authorization events.

**`POST /v1/webhooks`** *(Webhooks folder)*

✓ Test script captures `webhook_id` and logs the secret (shown once — copy it immediately).

---

## Flow B — Admin / Operator (Internal)

Use `comprobify-internal.postman_collection.json`. Set `base_url` and `admin_secret`.

---

### Step 1 — Publish legal documents (first time or on update)

**`POST /v1/admin/legal-documents`** — run three times, once per document type.

The Admin folder has three separate requests already named **Publish Legal Document (TERMS)**, **(PRIVACY)**, **(DPA)** with placeholder markdown bodies. Replace the `contentMarkdown` with the real text from `docs/legal/` before going to production.

✓ Test script captures `legal_version` from the TERMS publish response.

All three must use the same `version` string so a single registration checkbox covers the full bundle.

---

### Step 2 — Create a tenant (admin-created, no self-service flow)

**`POST /v1/admin/tenants`** *(Admin folder)*

```json
{ "email": "client@company.com", "subscriptionTier": "STARTER" }
```

✓ Test script captures `tenant_id`.

Admin-created tenants skip `termsVersion` validation and start with `status: ACTIVE` — no email verification required.

---

### Step 3 — Create an issuer for the tenant

**`POST /v1/admin/issuers`** *(Admin folder — "Create Issuer (P12 upload)" request)*

Attach the tenant's `.p12` file and fill in `tenantId` (uses `{{tenant_id}}`), RUC, branchCode, etc.

✓ Captures `issuer_id` if you add the script — currently the request doesn't have one (add manually from the response if needed).

---

### Step 4 — Mint an API key for the tenant

**`POST /v1/admin/tenants/{{tenant_id}}/api-keys`** *(Admin folder)*

```json
{ "label": "default", "environment": "sandbox" }
```

✓ Test script captures `api_key` — share this with the tenant. Shown once.

---

### Step 4a — Generate legal documents for the tenant (admin-created tenants)

Admin-created tenants skip `termsVersion` validation at creation, so no legal document instances are auto-generated for them. Generate them now:

**`POST /v1/admin/tenants/{{tenant_id}}/legal-documents`** *(Admin folder)*

Creates PENDING instances (TERMS, PRIVACY, DPA) using the current published templates with the tenant's business name and RUC substituted in. The tenant can then view and accept them via their own API key.

Expected: `{ "ok": true, "generated": 3, "documents": [...] }`

> **Also use this** to backfill any existing tenant who registered before legal documents were first published, or after a template update when you want to regenerate their personalized copy immediately rather than waiting for lazy generation.

---

### Step 5 — Manually verify the tenant (if needed)

**`POST /v1/admin/tenants/{{tenant_id}}/verify`** *(Admin folder)*

Skips the email verification flow. Useful for tenants onboarded out-of-band.

---

### Step 6 — Check the payments review queue

**`GET /v1/admin/payments?status=REPORTED`** *(Admin folder)*

✓ Test script logs all pending payments and captures the first `payment_id`.

Run this after a tenant submits proof via `PATCH /v1/payments/{{payment_id}}/proof`.

---

### Step 7 — View the proof file

**`GET /v1/admin/payments/{{payment_id}}/proof`** *(Admin folder)*

✓ Test script asserts a file is returned. Postman displays the image or PDF inline.

---

### Step 8 — Approve or reject the payment

**`PATCH /v1/admin/payments/{{payment_id}}/review`** *(Admin folder)*

```json
{ "decision": "VERIFIED" }
```

To reject:
```json
{ "decision": "REJECTED", "rejectionReason": "Transfer amount does not match. Expected $19.00." }
```

✓ Test script logs the new payment status. On `VERIFIED`, the subscription moves to `PAYMENT_RECEIVED`.

---

### Step 9 — Self-bill the invoice

Issue an invoice from your **own** issuer (the operator's issuer) to the tenant as the buyer. This is a normal document creation through the Developer flow. Capture the resulting `accessKey`.

---

### Step 10 — Link the invoice to the subscription

**`PATCH /v1/admin/subscriptions/{{subscription_id}}/link-invoice`** *(Admin folder)*

```json
{ "accessKey": "<your-self-billed-invoice-access-key>" }
```

✓ Test script logs the new subscription status (`INVOICE_PROCESSING` or `ACTIVE` if already authorized).

Once SRI authorizes the linked invoice, the subscription automatically activates, the tenant's tier upgrades, and they receive a notification.

---

### Step 11 — Override tier directly (bypass billing)

**`PATCH /v1/admin/tenants/{{tenant_id}}/tier`** *(Admin folder)*

```json
{ "subscriptionTier": "GROWTH" }
```

Use only for testing or manual corrections — bypasses the proof/review/invoice pipeline entirely.

---

### Step 12 — Promote a tenant (admin override)

**`POST /v1/admin/tenants/{{tenant_id}}/promote`** *(Admin folder)*

Skips the `ACTIVE` status check that the tenant-facing promote requires. Returns production API keys shown once.

---

### Step 13 — Run scheduled jobs

| Request | When to run |
|---|---|
| `POST /v1/admin/jobs/notifications` | Cert expiry checks + webhook retry queue (normally every 5 min by external cron) |
| `POST /v1/admin/jobs/subscriptions` | Scheduled downgrades + renewal reminders + expired subscription cleanup (normally daily) |

Both are idempotent — safe to run manually at any time for testing.

---

## Variable reference

All variables are set at the **collection** level (not environment). Change them under
*Edit Collection → Variables*.

| Variable | Set by | Used in |
|---|---|---|
| `base_url` | You (manual) | Every request |
| `admin_secret` | You (manual) | All `X-Admin-Secret` headers |
| `api_key` | ✓ Register / Promote / Mint Key | `Authorization: Bearer {{api_key}}` |
| `legal_version` | ✓ List Documents / Publish TERMS | `termsVersion` in Register + Accept Legal |
| `verification_token` | You (from email) | Verify Email |
| `issuer_id` | ✓ Register / List Issuers | `X-Issuer-Id` on all document requests |
| `tenant_id` | ✓ Register / Create Tenant (admin) | Admin tenant routes |
| `access_key` | ✓ Create Invoice | All `/:accessKey/` document routes |
| `subscription_id` | ✓ Create Subscription / Promote | Admin subscription routes |
| `payment_id` | ✓ Create Subscription / List Payments | Proof upload + review routes |
| `api_key_id` | ✓ Mint Key | Revoke Key |
| `webhook_id` | ✓ Register Webhook | Update / Deregister Webhook |
| `notification_id` | Manual (from List Notifications) | Mark as Read |

---

## Tips

- **Run in folder order.** Each ✓ request sets the variable the next request needs. Don't skip steps unless you already have the variable set.
- **Watch the Postman console** (`View → Show Postman Console`) — test scripts log important one-time values (production API keys, webhook secrets) there.
- **Sandbox vs production**: all document endpoints behave identically in both environments. The difference is which SRI endpoint receives the document — sandbox uses `celcer.sri.gob.ec`, production uses `cel.sri.gob.ec`. Documents issued in sandbox have no fiscal validity.
- **SRI sandbox timing**: authorization in the SRI test environment is usually near-instant but can take a few seconds. If `GET .../authorize` returns `RECEIVED`, wait 5–10 seconds and retry.
- **Credit notes**: before creating a credit note, run `GET /v1/documents/{{access_key}}/credit-notes` to check the remaining balance on the original invoice. The sample credit note request references the original document by `number` in `originalDocument`.
