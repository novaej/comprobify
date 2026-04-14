# Frontend MVP

Plan for the Comprobify web UI. Target user: anyone who needs to issue Ecuadorian
electronic invoices — no API knowledge required.

See [STRATEGY.md](STRATEGY.md) for product context and [NEXT_STEPS.md](NEXT_STEPS.md)
for the API backlog.

---

## Goals

- You can create, send, and authorize your own invoices from a browser
- A non-developer client can do the same without touching the API
- The API product remains unchanged — the frontend is a UI layer on top of it
- Deployable for free or near-free alongside the existing API

## What this is NOT (MVP scope)

- Not a full accounting system
- No invoice templates or saved buyers (Phase 2)
- No multi-user teams or roles (Phase 2)
- No admin panel for managing other users (Phase 2)
- No payment collection from your own clients (separate product)

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14+ (App Router) | Solo-dev friendly, good ecosystem, free deploy on Vercel |
| Language | TypeScript | Catches the bugs you'll introduce at 11pm |
| Styling | Tailwind CSS | Fast, no context switching |
| Components | shadcn/ui | Free, unstyled-to-styled, copy-paste components |
| Forms | React Hook Form + Zod | Validation mirrors the API's validation rules |
| Data fetching | TanStack Query | Caching + background refetch — document status polling needs this |
| Auth | NextAuth.js (credentials provider) | Simple email/password sessions, no external service needed |
| Localization | next-intl | Best App Router support; Spanish default, English secondary |

**Repository:** separate repo from the API (e.g., `comprobify-web`). They deploy
independently. The frontend calls the existing API over HTTPS.

---

## Architecture overview

Two separate applications, two separate deployments. The frontend calls the Comprobify
API over HTTP exactly like any other client:

```
┌──────────────────────────────┐    HTTP + Bearer token    ┌──────────────────────────┐
│  Comprobify Web (Next.js)    │ ────────────────────────► │  Comprobify API          │
│                              │                           │  (Node.js/Express)       │
│  Server Components           │                           │                          │
│  Server Actions              │                           │  All existing routes     │
│  API Route proxies           │                           │  PostgreSQL database     │
│  NextAuth sessions           │                           │                          │
└──────────────────────────────┘                           └──────────────────────────┘
```

The frontend does not have its own "backend" in the traditional sense — Next.js Server
Components and Server Actions are the server-side logic. They run on the server, read
the API key from the encrypted session, and call the Comprobify API.

## Authentication approach

### MVP — you are the only user

No user database needed. Store your API key as an environment variable on the Next.js
server. NextAuth is not even required at this stage.

```bash
# Next.js .env
COMPROBIFY_API_KEY=your-api-key-here
COMPROBIFY_API_URL=https://api.comprobify.com
```

Every Server Component and Server Action reads `process.env.COMPROBIFY_API_KEY` directly.
Ship this, use it, find the real problems before adding any auth complexity.

### Phase 2 — multiple users

The frontend manages its own users in its own database. This is intentional: Comprobify
is an invoicing engine, not a user management system (see STRATEGY.md — Core principle).
User accounts, buyer address books, and product catalogs are frontend concerns.

**Frontend database** (separate PostgreSQL instance from Comprobify):

```sql
-- Who can log into the web app
CREATE TABLE users (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,         -- bcrypt
  comprobify_api_key TEXT NOT NULL,    -- Bearer token for the Comprobify API
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Saved buyers (optional, Phase 2 feature)
CREATE TABLE buyers (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,
  ruc           TEXT NOT NULL,
  email         TEXT,
  address       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Saved products/services (optional, Phase 2 feature)
CREATE TABLE products (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  description   TEXT NOT NULL,
  unit_price    NUMERIC(10,2) NOT NULL,
  tax_code      TEXT NOT NULL,         -- IVA rate
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

**Login flow:**
```
Browser POSTs email + password to Next.js
  → NextAuth authorize() queries frontend DB, validates bcrypt password
  → Stores comprobify_api_key in encrypted NextAuth JWT (server-side only)
  → All subsequent Comprobify API calls use the stored key
```

No changes to the Comprobify API. No `users` table in the Comprobify database.
The only link between the two systems is the API key.

**What the boundary looks like in practice:**

```
Frontend DB                           Comprobify API
───────────────                       ───────────────────────────────
users                                 issuers (RUC, certificate)
  └─ comprobify_api_key ──────────►   api_keys (authentication)
buyers                                documents (XML, status, audit)
products                              document_line_items
                                      document_events
```

Onboarding (Phase 2, still manual): create issuer + API key via the Comprobify admin
API, then insert a row into the frontend `users` table with their email, bcrypt password,
and the API key.

Self-service registration is Phase 3 (requires billing integration and automated
issuer provisioning via the Comprobify admin API).

---

## Auth duality: UI users and API clients

**The API needs no changes to support the frontend.**

**The API key is never sent from the browser.** This is the critical security property.
The browser only ever makes requests to the Next.js server (same domain). The Next.js
server reads the API key from the encrypted session and calls the Comprobify API
server-to-server. The API key never appears in browser DevTools.

```
Browser ──────────────────► Next.js server
        (no API key visible)       │  reads API key from
                                   │  encrypted session cookie
                                   ▼
                            Comprobify API
                     (Authorization: Bearer <api-key>)
                     (server-to-server, not visible to browser)
```

This is the **Backend-for-Frontend (BFF)** pattern. Next.js App Router is built for it:
Server Components fetch data on the server before the page renders, and Server Actions
handle mutations — neither exposes the API key to the browser.

### Does the login endpoint return the API key?

No. This is the key point. When the user submits email + password:

```
Browser POSTs /api/auth/signin  (email + password)
  → NextAuth runs authorize() on the server — checks DB, validates password
  → NextAuth encrypts the result into a JWT using NEXTAUTH_SECRET (AES)
  → Response to browser: Set-Cookie: next-auth.session-token=<encrypted-blob>
                         HttpOnly; Secure; SameSite=Lax
  → No JSON body. No API key anywhere in the response.
```

DevTools shows a `Set-Cookie` header containing an encrypted blob. Copying it is useless
without `NEXTAUTH_SECRET`. The API key is inside that blob, encrypted.

### The JWT/session split — the trap to avoid

NextAuth has two separate objects that look similar but behave differently:

- **`token`** — the full JWT, only accessible on the server via `getToken()`
- **`session`** — a subset exposed to the browser via `useSession()`

If the API key ends up in `session`, it reaches the browser. Keep it in `token` only:

```ts
callbacks: {
  jwt({ token, user }) {
    // user is only defined on sign-in — copy API key into the token
    if (user) token.apiKey = user.apiKey  // lives in encrypted JWT, never leaves server
    return token
  },
  session({ session, token }) {
    // This object is sent to the browser — DO NOT include token.apiKey here
    session.user.issuerId = token.issuerId  // fine — not sensitive
    return session                          // apiKey is absent
  }
}
```

Reading the API key on the server (Server Components, Server Actions, API Routes):
```ts
import { getToken } from 'next-auth/jwt'
const token = await getToken({ req })
const apiKey = token.apiKey  // only reachable server-side
```

`getToken()` is a server-only function. It cannot be called from client components.

### Session security

The session cookie is:
- **Encrypted** (AES via `NEXTAUTH_SECRET`)
- **httpOnly** — browser JavaScript cannot read the cookie
- **Secure** — only sent over HTTPS
- **SameSite: lax** — blocks cross-site request forgery

### Settings screen: showing the API key

The Settings screen lets users copy their API key for direct API use. This IS a case
where the key is deliberately returned to the browser — the user explicitly requested it.
Implement it as a Server Action triggered by a "Reveal" button:

```ts
'use server'
async function revealApiKey() {
  const token = await getToken({ req })
  return token.apiKey  // returned only on explicit user action
}
```

This is the same pattern as GitHub's "Show token once" button — acceptable because the
user opted in. The key should not be included in the initial page load.

### How each request type works

**Page loads (Server Components):**
```ts
// app/dashboard/page.tsx — runs on the server, never in the browser
const session = await getServerSession()
const data = await fetch(`${API_URL}/api/documents`, {
  headers: { Authorization: `Bearer ${session.apiKey}` }
})
```

**Mutations — create invoice, send to SRI, etc. (Server Actions):**
```ts
// app/actions/createInvoice.ts — runs on the server
'use server'
const session = await getServerSession()
const res = await fetch(`${API_URL}/api/documents`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${session.apiKey}` },
  body: JSON.stringify(payload)
})
```

**Client-side polling — status check while waiting for SRI (API Route proxy):**

The one case that needs client-side execution is polling document status every few
seconds. For this, create a thin Next.js API route that proxies the call:

```ts
// app/api/documents/[key]/status/route.ts
export async function GET(req, { params }) {
  const session = await getServerSession()
  const res = await fetch(`${API_URL}/api/documents/${params.key}`, {
    headers: { Authorization: `Bearer ${session.apiKey}` }
  })
  return Response.json(await res.json())
}
```

The browser calls `/api/documents/:key/status` (Next.js domain, no API key).
TanStack Query polls this proxy route. The API key stays on the server.

### Data fetching approach (revised)

| Use case | Approach | API key visible to browser? |
|---|---|---|
| Dashboard invoice list | Server Component | No |
| Invoice detail page | Server Component | No |
| Create invoice | Server Action | No |
| Send to SRI | Server Action | No |
| Rebuild invoice | Server Action | No |
| Status polling (RECEIVED → AUTHORIZED) | API Route proxy + TanStack Query | No |
| Download PDF / XML | Server Action → redirect to signed URL or stream | No |

TanStack Query is retained for the polling use case but queries Next.js proxy routes,
not the Comprobify API directly.

### Auth duality: UI users and direct API users

**A user who wants both UI and direct API access** can retrieve their API key from the
Settings screen. The same key works in both contexts — pasted into Postman or used
directly in code. There is no separate "UI token" vs "API token."

### Do we need refresh tokens?

No. The refresh token pattern exists because OAuth2 access tokens expire quickly by design.
Neither credential here works that way:

- **API keys** don't expire on a timer — only invalidated when explicitly revoked
- **NextAuth sessions** auto-renew on activity (sliding `maxAge`) — no refresh token needed

**The one scenario to handle: API key revocation.**

If a key is revoked while a user is logged in, the next proxied API call returns `401`.
Handle it in the proxy routes and Server Actions:

```ts
if (res.status === 401) {
  // In a Server Action: redirect to login
  // In an API Route: return 401 → client calls signOut() and redirects
}
```

**NextAuth session configuration:**
```ts
session: {
  strategy: 'jwt',
  maxAge: 7 * 24 * 60 * 60,  // 7 days, renewed on each request
}
```

---

## Localization

The UI ships in **Spanish as the default language**. English is a secondary locale added
from the start so it never becomes a painful migration later.

### Library

`next-intl` — best App Router support, straightforward message files.

```
comprobify-web/
  messages/
    es.json    ← default, always complete
    en.json    ← secondary, kept in sync
```

### What goes in message files

Everything visible to the user:
- Navigation labels, button text, form labels, placeholder text
- Validation error messages (e.g., "El RUC debe tener 13 dígitos")
- Status labels — map API status codes to display strings:
  ```json
  "status": {
    "SIGNED": "Firmado",
    "RECEIVED": "Recibido por SRI",
    "AUTHORIZED": "Autorizado",
    "RETURNED": "Devuelto",
    "NOT_AUTHORIZED": "No autorizado"
  }
  ```
- API error codes — the API already returns stable `SCREAMING_SNAKE_CASE` codes
  (e.g., `DOCUMENT_NOT_FOUND`, `VALIDATION_ERROR`) designed as i18n keys (ADR-011).
  Map each code to a user-friendly message in the locale files:
  ```json
  "apiError": {
    "DOCUMENT_NOT_FOUND": "El comprobante no existe.",
    "TOO_MANY_REQUESTS": "Demasiadas solicitudes. Intente en un momento.",
    "VALIDATION_ERROR": "Revise los campos marcados en rojo."
  }
  ```
- Page titles and headings
- Date and number formatting (`Intl.DateTimeFormat` / `Intl.NumberFormat` — use locale
  `es-EC` for Ecuador; amounts in USD with `.` decimal separator)

### What does NOT go in message files

- SRI XML element names — those are fixed by SRI spec and never displayed in the UI
- API field names in JSON — those are internal
- Database values — document content is stored as entered by the user

### Locale switching

MVP: Spanish only visible in the UI. English locale file exists in the codebase for
correctness but no language switcher is needed yet. Add the switcher in Phase 2 when
you have a non-Spanish-speaking client.

### URL structure

`next-intl` supports two approaches:
- Prefix routing: `/es/dashboard`, `/en/dashboard`
- Domain routing: `app.comprobify.com` (es), `app.comprobify.com/en` (en)

For MVP use **prefix routing** — simpler to set up, easy to change later.

---

## Screens

### 1. Login

- Email + password form
- Redirects to Dashboard on success
- No "forgot password" in MVP — you have one user (yourself)

### 2. Dashboard

The first thing you see after login.

**Contents:**
- Summary cards: total invoices, authorized this month, pending (SIGNED/RECEIVED)
- Invoice list (most recent first) with columns:
  - Sequential number
  - Buyer name
  - Total amount
  - Status badge (color-coded)
  - Date
- "New Invoice" button → goes to Create Invoice

**API calls:**
- `GET /api/documents` — paginated invoice list (add this endpoint to NEXT_STEPS if missing)

### 3. Create Invoice

A form that maps to `POST /api/documents`.

**Sections:**

**Buyer**
- RUC / cédula / pasaporte (with type selector)
- Business name / full name
- Address
- Email (for the authorized invoice email)
- Phone (optional)

**Line items** (add/remove rows)
- Description
- Quantity
- Unit price
- Discount % (optional)
- Tax (IVA 15% / 0% / exempt — selector)

**Payment**
- Payment method (cash, transfer, card, credit — SRI codes)
- Payment term (days)

**Totals** — calculated live as user types:
- Subtotal (without tax)
- Discount
- Taxable base
- IVA amount
- Total

**Submit button:** "Generar comprobante"

On success → redirect to Invoice Detail for the created document.

**Notes:**
- Issue date defaults to today
- Sequential number and access key are generated by the API — don't show in the form
- Document type defaults to `01` (factura) in MVP

### 4. Invoice Detail

Shows full invoice state and available actions.

**Header:**
- Access key (truncated, copy button)
- Sequential number
- Status badge
- Issue date
- Buyer name + RUC

**Body:**
- Line items table
- Totals breakdown

**Actions (contextual — shown based on status):**

| Status | Actions available |
|---|---|
| SIGNED | "Enviar al SRI" button → calls `POST /:key/send` |
| RECEIVED | "Verificar autorización" button → calls `GET /:key/authorize` (polls until resolved) |
| AUTHORIZED | Download PDF button → `GET /:key/ride`, Download XML button → `GET /:key/xml`, Resend email button → `POST /:key/email-retry` |
| RETURNED | "Ver errores SRI" (show SRI messages), "Reconstruir" button → calls `POST /:key/rebuild` |
| NOT_AUTHORIZED | Same as RETURNED |

**Events timeline:**
- Chronological list of all `document_events` rows
- Shows event type, timestamp, and any notes
- API: `GET /:key/events`

### 5. Settings

- Issuer information (read-only in MVP — displayed from the API key's issuer)
- Certificate expiry date and fingerprint
- API key display (masked, reveal button) — for users who also want to use the API directly
- Change password form

---

## User flows

### Create and authorize an invoice (happy path)

```
Dashboard → "New Invoice"
  → Fill form → Submit
  → Invoice Detail (status: SIGNED)
  → Click "Enviar al SRI"
  → Invoice Detail (status: RECEIVED — show spinner/polling message)
  → Click "Verificar autorización" (or auto-poll every 5s)
  → Invoice Detail (status: AUTHORIZED)
  → Download PDF or XML
```

### Handle a returned invoice

```
Invoice Detail (status: RETURNED)
  → Read SRI error messages
  → Click "Reconstruir"
  → Form pre-filled with existing invoice data (editable)
  → Submit → Invoice Detail (status: SIGNED)
  → Continue with happy path
```

---

## API endpoints used

| Screen | Method | Endpoint |
|---|---|---|
| Dashboard | GET | `/api/documents` |
| Create Invoice | POST | `/api/documents` |
| Invoice Detail | GET | `/api/documents/:key` |
| Send to SRI | POST | `/api/documents/:key/send` |
| Authorize | GET | `/api/documents/:key/authorize` |
| Rebuild | POST | `/api/documents/:key/rebuild` |
| Download PDF | GET | `/api/documents/:key/ride` |
| Download XML | GET | `/api/documents/:key/xml` |
| Events timeline | GET | `/api/documents/:key/events` |
| Resend email | POST | `/api/documents/:key/email-retry` |

**One endpoint missing from the current API:** `GET /api/documents` (list with pagination
and filtering). The current API only exposes individual documents by access key. Add this
to NEXT_STEPS as a prerequisite for the Dashboard.

---

## What the API needs before the frontend can launch

1. `GET /api/documents` — paginated list filtered by the authenticated issuer.
   This is the only API gap. Everything else already exists.
2. Health endpoint (NEXT_STEPS #3) — needed for the frontend to check API availability.

---

## Deployment

| Service | Frontend | Cost |
|---|---|---|
| Vercel | Free tier (hobby) — Next.js deploys perfectly here | $0 |
| Render | Free tier sleeps after inactivity — avoid for the API; fine for low-traffic frontend | $0 |
| Railway | $5/month hobby — if you want it always-on from day one | $5/month |

The frontend has no heavy compute needs. Vercel free tier is the right starting point.

Database for `frontend_users`: add a table to the existing API database. One less moving part.

---

## Phase 2 (after MVP works for you personally)

- Self-service registration (user signs up, picks a tier, uploads P12, pays via Kushki)
- Saved buyer address book
- Invoice templates / drafts
- Multi-user (invite accountant to view/download, not create)
- Notas de crédito UI (once the API supports document type `04`)
- Spanish localization throughout (the API already generates Spanish XML; the UI should match)
- Mobile-responsive design (the MVP should be functional on mobile but not optimized)

---

## Open questions

- Should the rebuild form be pre-filled (edit the original) or blank (start fresh)?
  Pre-filled is better UX but requires the frontend to parse the stored XML or re-expose
  the original payload — check what the API returns on `GET /api/documents/:key`.
- Auto-polling on RECEIVED status: how long before giving up and showing "check back later"?
  SRI typically responds in 5-30 seconds but can take minutes. Suggest: poll every 5s
  for 2 minutes, then show manual "check" button.
- Language: build the UI in Spanish from the start. Your users are in Ecuador.
