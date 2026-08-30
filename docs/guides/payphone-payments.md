# Card Payments via Payphone — How the Flow Works and How to Respond

Tenants can pay a subscription by card through Payphone's *Cajita de Pagos*, alongside the existing manual SPI bank transfer. Card payments verify themselves: there is no proof to upload and no review to perform, so a tenant is active seconds after paying. See [ADR-028](../adr/028-payphone-card-payments.md) for the design rationale and CLAUDE.md's "Subscription + payment pipeline" entry for how it fits the wider billing model.

::: warning This is how tenants pay *us*
Card payment is for a tenant settling their own Comprobify subscription. It is **not** a capability tenants use to collect money from their own customers — there is no way to create an arbitrary charge. `createSession` only ever targets an existing `payments` row the calling tenant owns, and `payments` rows are created in exactly one place (`subscription.service.js`, for subscription billing); the amount comes from that row, never from the request.

It is also **comprobify-web only in practice**: Payphone's widget renders solely on the domain registered in their developer console. A third-party integrator could mint a session over the API and then find the widget won't load on their domain, which is why these endpoints are deliberately absent from the public docs site and the tenant-facing Postman collection. Integrators pay by SPI transfer.
:::

This guide covers what those don't: **the full flow end to end**, **what every failure mode looks like**, and **what you actually have to do about each one**.

---

## The full flow

```
comprobify-web                  comprobify API                    Payphone
     |                                |                               |
 (1) |-- POST /v1/payments/:id/payphone-session -->                   |
     |<-- { token, storeId, clientTransactionId, amount, ... } -------|
     |                                |                               |
 (2) payphone-payment-box.js init(config)                             |
     <div id="pp-button">  --> payer enters card ------------------->  |
     |                                                     (charge held)
     |                                                                |
 (3) |<-- redirect to responseUrl?id=..&clientTransactionId=.. -------|
     |                                |                               |
 (4) |-- POST /v1/payments/payphone/confirm ------>                   |
     |                                |-- POST /api/confirm --------->|
     |                                |<-- { statusCode: 3, ... } ----|  <-- charge CAPTURED here
     |                                |                               |
 (5) |                                | payment VERIFIED              |
     |                                | applyVerifiedPayment()        |
     |                                | -> subscription ACTIVE        |
     |<-- { status: 'APPROVED' } -----|                               |
     |                                |
 (6) |                                +-- operator email: "invoice owed"
     |                                +-- payment appears in GET /v1/admin/invoicing/pending
```

**The five-minute rule governs everything.** Payphone holds the charge at step 2 and **auto-reverses it if step 4 doesn't happen within 5 minutes**. That is why the return page must call confirm *immediately on load*, never behind a button. If confirm never fires, the money goes back to the payer on its own and our record is reconciled later — no money is lost, but the tenant paid and nothing happened until we notice.

Steps 1–4 are the tenant's; steps 5–6 are ours. Step 6 is the part that still needs you: **a card payment does not issue its own factura.** It lands in the invoicing queue exactly like a verified bank transfer.

### Who owns what

| Piece | Where it runs | Why there |
|---|---|---|
| The widget | comprobify-web (browser) | It only runs on the domain registered in Payphone's console. |
| The session config | This API (`payphone-payment.service.js`) | Keeps the token out of the frontend bundle — it's still visible in the browser (unavoidable with the Cajita) but centrally rotatable and only handed to an authenticated tenant. |
| The **confirm call** | This API | It captures the money. It uses the secret token and must never be issued by a browser. |
| The return page | comprobify-web | Payphone redirects a browser there; it exists only to forward two query params to us. |

---

### One attempt row per widget open, never reused

Each `createSession` mints a fresh `clientTransactionId` and a new row. Attempts are **deliberately not reused**, because a `PENDING` row with no vendor id is ambiguous: either the payer closed the widget without paying (Payphone never saw the id, safe to reuse) or they paid and the redirect never arrived (Payphone *did* see it and may be holding a charge). We cannot tell those apart, and reusing the id in the second case is a duplicate submission against a live transaction — Payphone requires it to be unique per transaction.

The cost is small: abandoned attempts are expired by a plain `UPDATE`, no vendor call. A ceiling of 10 unresolved attempts per payment (`409 PAYPHONE_TOO_MANY_ATTEMPTS`) stops a frontend loop growing them without bound.

Frontends should mint one session per checkout and hold it for the widget's 10-minute life, rather than re-minting on every modal open.

### Telling environments apart in Payphone's console

`APP_ENV` is `staging` both locally and on the droplet, so it cannot separate them. The `reference` we send carries `os.hostname()` outside production instead — the same discriminator `logger.service.js` uses:

| Where | `reference` on the transaction |
|---|---|
| Local dev | `Comprobify INITIAL · Jonathans-MacBook-Pro.local` |
| Staging droplet | `Comprobify INITIAL · comprobify-api-staging` |
| Production | `Comprobify INITIAL` |

Production is deliberately bare: `reference` appears on the payer's receipt, and a real customer should never see infrastructure hostnames. Payphone caps it at 100 characters, so it's truncated defensively.

## Attempt states

Every card attempt is a row in `payphone_transactions` — **one row per attempt, not per payment**, so a retried card leaves the declined attempt behind as audit trail.

| Status | Meaning | Terminal? |
|---|---|---|
| `PENDING` | Session minted; outcome unknown. Either confirm hasn't run yet, or it ran and the network failed. | No — reconciliation chases it |
| `APPROVED` | Payphone confirmed a captured charge. | Yes |
| `CANCELLED` | Payphone reported a non-approved outcome (declined, cancelled by payer). | Yes |
| `EXPIRED` | Never confirmed inside the 5-minute window, so Payphone auto-reversed it. Set by reconciliation. | Yes |
| `DUPLICATE` | Approved, but its payment had already been paid by another attempt. **Real money needing a manual refund.** | Yes |
| `ERROR` | Confirmed but unusable — currently only an amount that didn't match what the session was minted for. | Yes |

`applied_at` is separate from status: `APPROVED` means the money is ours, `applied_at` means the tenant actually got their tier. The gap between them is real and recoverable — see below.

---

## Failure modes

### Declined card

**Tenant sees:** the widget's own decline message, then our return page reporting the attempt didn't go through.
**Data:** attempt `CANCELLED`; `payments.status` stays `PENDING`.
**Action:** none. This is not a rejected payment — the tenant simply requests a fresh session and tries again. No notification fires and nothing enters your queue.

### The confirm call couldn't reach Payphone

**Tenant sees:** `502 PAYPHONE_CONFIRM_FAILED` — "will be reconciled automatically shortly."
**Data:** attempt stays `PENDING`, but **`payphone_transaction_id` is recorded**. Deliberately not marked terminal: the charge's real state is unknown, and recording it as declined would strand real money.
**Action:** none. The reconciliation job retries the confirm with that id. If the original request actually reached Payphone and only the response was lost, the charge *was* captured — this retry is what finds it and credits the tenant. Without the id persisted there is nothing to look the charge up by, and it would be marked `EXPIRED` and lost.

### Payer closed the browser before the return page loaded

**Tenant sees:** nothing. They paid and navigated away.
**Data:** attempt stays `PENDING` with **no `payphone_transaction_id`** — that id only ever arrives on the return redirect. Payphone auto-reversed the charge at the 5-minute mark, so the tenant's money is back.
**Action:** none — reconciliation marks it `EXPIRED` directly. It makes no vendor call here: with no id there is nothing to ask about, and the 5-minute window has long passed. If the tenant complains they were charged, the reversal may not have settled on their statement yet; the attempt row's `confirm_response` records the transaction outcome Payphone reported (filtered — see the note below).

### The process died between capturing and applying

This is the one genuinely two-phase step. The vendor outcome commits *before* `applyVerifiedPayment` runs, so a crash in between leaves **money captured and the tenant not credited**.

**Tenant sees:** their payment appeared to succeed but their plan didn't change.
**Data:** attempt `APPROVED` with `applied_at IS NULL`; `payments.status` still `PENDING`.
**Action:** none — the reconciliation job's second sweep finds exactly this shape and finishes the job. To confirm it's the case you're looking at:

```sql
SELECT client_transaction_id, status, confirmed_at, applied_at
FROM payphone_transactions
WHERE status = 'APPROVED' AND applied_at IS NULL;
```

If that returns rows for more than a few minutes, the reconciliation job isn't running — check `/opt/comprobify/logs/cron-payphone-reconciliation.log` on the droplet.

### Duplicate charge — the one that needs you

A tenant with two tabs open can complete the widget twice, producing two real charges against one payment.

**Tenant sees:** two charges on their card statement.
**Data:** first attempt `APPROVED` and applied; second `DUPLICATE`, never applied (applying twice would double-extend a period or double-flip a tier).
**You see:** a `logger.error` line and a Sentry event — *"Duplicate Payphone charge captured — manual refund required"* — carrying the payment id, both transaction ids, and the amount.
**Action, and this one is manual:**

1. Reverse the duplicate in the **Payphone Business dashboard**, using the `payphoneTransactionId` from the alert. Payphone only permits reversal the same day, until 20:00 EC — after that it becomes a refund request on their side.
2. Do **not** call `PATCH /v1/admin/payments/:id/refund`. That endpoint rolls back the *subscription*, and the subscription is correctly paid for — one of the two charges was legitimate. The duplicate never touched subscription state.

---

## "I paid but nothing happened"

Work down this path. Start from whatever the tenant can give you — the `clientTransactionId` is on the return page URL, otherwise start from their email.

```sql
-- 1. Find the attempt.
SELECT pt.id, pt.status, pt.confirmed_at, pt.applied_at, pt.amount_cents,
       pt.payphone_transaction_id, pt.confirm_response
FROM payphone_transactions pt
WHERE pt.client_transaction_id = '<clientTransactionId>';

-- ...or from the tenant's email:
SELECT pt.client_transaction_id, pt.status, pt.applied_at, p.status AS payment_status, p.purpose
FROM payphone_transactions pt
JOIN payments p       ON p.id = pt.payment_id
JOIN subscriptions s  ON s.id = p.subscription_id
JOIN tenants t        ON t.id = s.tenant_id
WHERE t.email = '<email>'
ORDER BY pt.created_at DESC;
```

Then read the result:

| What you see | What happened | What to do |
|---|---|---|
| No row at all | They never got as far as a session. | Nothing was charged. |
| `PENDING`, recent | Confirm hasn't run or couldn't reach Payphone. | Wait one reconciliation cycle (~5 min). |
| `PENDING`, old | Reconciliation isn't running. | Check the cron log on the droplet. |
| `CANCELLED` | The card was declined. | Tell them to retry; nothing was charged. |
| `EXPIRED` | Charge auto-reversed — they never reached the return page. | Money is back with them; ask them to pay again. |
| `APPROVED`, `applied_at` set | It worked. | Check `payments`/`subscriptions` — if the tier looks wrong, the problem is downstream of Payphone, not in it. |
| `APPROVED`, `applied_at` NULL | Captured but not credited. | Run the reconciliation job; it self-heals. |
| `DUPLICATE` | Second charge for an already-paid payment. | Refund it in the Payphone dashboard (above). |
> **`confirm_response` is filtered, not raw.** `payphone.service.js` keeps an allow-list of the money, status and card-metadata fields (`PERSISTED_FIELDS`) and drops everything else — Payphone returns the payer's email, phone and cédula, which we have no use for and do not retain. If a dispute needs a field that isn't there, it is in Payphone's own dashboard; add it to the allow-list only if there is a standing reason to keep it.

| `ERROR` | Amount mismatch — we refused to apply it. | Investigate before refunding; `confirm_response` has the amount and status Payphone reported. |

---

## After a successful payment: you still owe a factura

Card payments change *how the money arrives*, not the operator's invoicing obligation. Since [ADR-027](027-decouple-activation-from-invoice.md) a verified payment grants access immediately and the invoice is tracked separately:

```
GET /v1/admin/invoicing/pending
```

Card payments appear there automatically — the queue is simply "verified and not yet invoiced", so no card-specific code feeds it. Because nothing else would tell you (no human clicked "verify"), an email goes to `ADMIN_NOTIFICATION_EMAIL` the moment a card payment settles. SPI payments deliberately don't send that email: you reviewed those yourself.

Issue the invoice through your own issuer as normal, then record it:

```
PATCH /v1/admin/subscriptions/:id/link-invoice   { "accessKey": "..." }
```

---

## Reversals and refunds

Detecting a reversal is manual and always will be — no payment rail notifies us, and Payphone documents no notification for cardholder chargebacks (see ADR-027, where the same conclusion was reached for SPI). When you find one:

**Our refund endpoint moves no money.** `PATCH /v1/admin/payments/:id/refund` touches only our database; there is no call to Payphone's reverse API, by design. Returning the money is always manual.

1. Reverse or refund on **Payphone's** side (dashboard; same-day until 20:00 EC). Do this **first** — reversed, and a failed dashboard reversal leaves a tenant downgraded but still charged, with nothing flagging it.
2. Roll our side back with `PATCH /v1/admin/payments/:id/refund`. It restores `payments.applied_from` — the snapshot taken just before the payment was applied — so a reversed `TIER_CHANGE` returns to the previous *paid* tier and a reversed `RENEWAL` rolls the period back. It is not "downgrade to FREE".
3. **Except for a `DUPLICATE` attempt** — refund it in the dashboard and stop. The subscription is correctly paid by the other attempt, and the duplicate never touched subscription state, so calling our refund endpoint would strip a tier the tenant did pay for.
4. Decide separately whether the tenant should be suspended (`PATCH /v1/admin/tenants/:id/status` with a `suspensionReasonCode`, `PAYMENT_REVERSED` being the obvious one). The refund endpoint deliberately never suspends anyone on its own.

---

## Setting it up: one Payphone application per environment

**You need a separate Payphone application for staging and for production — this is forced, not a preference.** A `WEB`-type application has a single **Web Domain** and a single **Response URL**, and *"only the registered domain can access our Payphone payment buttons."* Staging and production are different frontend domains, so one application cannot serve both.

Create each at [appdeveloper.payphonetodoesposible.com](https://appdeveloper.payphonetodoesposible.com/) → **+ Agregar**, type **WEB** (not `API` — that's for payment links and API Sale):

| Field | Staging | Production |
|---|---|---|
| Web Domain | your staging frontend domain | your production frontend domain |
| Response URL | `https://<staging-frontend>/pagos/payphone/retorno` | `https://<prod-frontend>/pagos/payphone/retorno` |
| Environment mode | test | production |

**What the Response URL actually is, because it shapes the failure handling:** Payphone redirects the payer's *browser* there once they finish or abandon the form, appending `?id=<payphoneTransactionId>&clientTransactionId=<ours>`. It is **not a webhook** — Payphone's servers never call it. It only fires if the user's browser actually arrives, which is exactly why "payer closed the browser" is a real failure mode, why the five-minute auto-reversal can bite, and why the reconciliation job exists at all. It must be a real page that can issue a request, not a JSON endpoint. Absent Payphone's External Notification service, this redirect is the *only* way we learn a payment happened.

Note the Web Domain and the Response URL are independent fields: registering a domain lets the widget **render** there, while the Response URL decides where the redirect **goes**. Registering `localhost` alongside a staging domain therefore lets you render and submit locally — which is enough to validate that the widget accepts the token and that Payphone accepts our amount mapping, since both are checked at submit, before any redirect — but the redirect still lands wherever the single Response URL points. For the full loop locally, give local development its own application rather than toggling that field back and forth and breaking staging while you do.

Token and StoreID are then on that application's **Credenciales** tab, and go into that environment's `.env` as `PAYPHONE_TOKEN`/`PAYPHONE_STORE_ID`. Nothing in the code couples Payphone to `APP_ENV` — two applications simply means two sets of env vars.

The **environment mode is selected inside an application's own configuration**, separately from having two applications. Worth confirming by eye when you set this up: Payphone's docs don't state whether flipping that mode also changes the Token/StoreID. If it does, staging's credentials aren't stable across a mode flip.

> **The failure mode to guard against is procedural, not technical.** Nothing in the code can tell a test token from a live one — if production credentials are ever pasted into staging's `.env`, staging will create **real charges**. The deployment checklist in `../deployment.md` carries this; treat it as a real item, not boilerplate.

### Getting access at all

The Payphone Developer platform is not standalone: a Developer is a **user role inside a Payphone Business account**, and opening one requires an **active RUC** — their support docs state a cédula is not sufficient. So the RUC gate applies to the **test** environment too, not only production; you cannot create even a sandbox application without it.

(In Ecuador a *persona natural* can hold a RUC, and their wording rules out a cédula rather than a personal RUC — so test access may be obtainable before the company exists. Worth confirming on their signup rather than assuming either way.)

Full production card processing additionally requires KYC against the registered legal entity — the blocker NEXT_STEPS.md #3 documents for card processors generally, and the same one gating production launch.

**Until any of that exists, leave `PAYPHONE_TOKEN` unset in every environment.** That is a fully supported state, not a half-configuration: the card endpoints return `503`, SPI is untouched, and the reconciliation job is a no-op with no attempts to sweep.

That said, three assumptions in this integration are unverified until a real application exists, and all three are cheap to settle in test mode but expensive to discover in production — a failed confirm means Payphone auto-reverses at 5 minutes, so a customer pays and gets nothing:

1. ~~Which host answers `confirm`~~ — **settled.** Both `paymentbox.payphonetodoesposible.com/api/confirm` (our default) and the redirect button's `pay.payphonetodoesposible.com/api/button/V2/Confirm` answer, and both authenticate the same application token. No `PAYPHONE_API_BASE_URL` override is needed.
2. Whether the **widget** accepts that same token. Confirm does (see above); the browser side is only provable by rendering it.
3. ~~Whether Payphone accepts our amount-field mapping~~ — **settled.** `amountWithoutTax: 0` with the whole base in `amountWithTax` is accepted; verified by pushing our real `toAmountBreakdown()` output at their `Prepare` endpoint across STARTER monthly, GROWTH monthly and BUSINESS yearly. That probe also surfaced a rule their docs don't mention: **Payphone refuses any charge under $1.00** (`errorCode 107`, *"El monto a cobrar debe ser mayor o igual a 1,00"*). `createSession` now returns `400 PAYPHONE_AMOUNT_BELOW_MINIMUM` for those so the frontend can fall back to bank transfer — reachable in practice via a prorated upgrade with a few hours left in the period, which lands around $0.29.


Get a test application before production for the one remaining item, not for decline testing — test mode approves everything.

> **Payphone answers "transaction not found" with HTTP 404 and a structured body** (`errorCode: 20`). That is semantic, not routing — verified against the live test store. `payphone.service.js` returns `{ ok: false, body }` with no `error` field for that case, so `confirmTransaction` treats it as a terminal outcome rather than a transport failure, which is correct: the charge genuinely does not exist. A probe that reads the HTTP status before checking for a Payphone error body will misreport a working host as a broken one.

## Testing

Card payments are **optional infrastructure**: with `PAYPHONE_TOKEN` unset, `POST /v1/payments/:id/payphone-session` returns `503 PAYMENT_GATEWAY_NOT_CONFIGURED` and the entire SPI flow is unaffected. That is deliberate — a vendor outage or a misconfigured deploy can never take billing down with it, and it means an environment without Payphone credentials is a supported configuration rather than a broken one.

With test-store credentials set, the flow is exercisable end to end. For forcing the reconciliation job's two sweeps without a real payment, see the Payphone section of [testing-scheduled-jobs.md](testing-scheduled-jobs.md).

Two things to verify against the real store before trusting production:

- **The confirm endpoint host.** Payphone's docs give `paymentbox.payphonetodoesposible.com/api/confirm` for the Cajita and `pay.payphonetodoesposible.com/api/button/V2/Confirm` for the redirect button. `PAYPHONE_API_BASE_URL` exists so this is configurable, but confirm which one your application actually answers on.
- **Whether the widget and the confirm call want the same token.** If Payphone issues separate ones, put the narrower one in the browser and keep the confirm token server-side only.
