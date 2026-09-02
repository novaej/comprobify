# Your subscription and how to pay it

This page explains how your Comprobify subscription works and how to pay for it. **All of it is handled from the Comprobify web app** — you don't need to integrate anything over the API to pay, change plan, or cancel.

::: tip This is how you pay *us*
Not to be confused with issuing documents. Your subscription is what you pay Comprobify for using the service; the invoices you issue to *your* customers are something else entirely, and those are what the API is for (see [Documents](endpoints/create-invoice.md)).
:::

## Choosing a plan

Available plans, with their monthly base document quota, prices and limits, are viewed and chosen from the Comprobify web app — there's no public endpoint intended for external integrators to read the plan catalog.

Billing is **monthly** or **yearly**. Yearly costs the equivalent of 10 months (two months free). **How your quota is consumed depends on which you choose:** on monthly billing, your quota resets every month; on yearly billing, you get a full 12 months' worth of quota (monthly figure × 12) up front for the whole year, consumable evenly or unevenly — it does not reset month to month. The Enterprise tier has no quota at all — it's unlimited either way.

## Two ways to pay

### Card

You pay by card in the web app and **your plan is active within seconds**. There's nothing to upload and no review to wait on.

Behind the scenes the charge is processed by Payphone. After completing the payment form you're redirected back to Comprobify, which confirms the charge automatically. If you close the browser at that moment the charge reverses itself and the money returns to your card — just try again whenever you like.

If your card is declined nothing is charged and you can retry immediately.

Payphone won't process charges under **$1.00**. This is rare — it only comes up on a prorated tier change with very little of the period left — but when it does, the card option won't be available and you'll need to pay by transfer.

### Bank transfer (SPI)

The web app shows you the account details to transfer to. Once you've made the transfer, you upload proof of it (image or PDF) along with your bank's reference number.

Your provider checks the proof against the bank and either approves or rejects it. **You'll get a notification and an email the moment they record their decision** (see [Notifications](endpoints/notifications.md)). If approved, your plan activates right then.

If rejected, the email says why (for example, the amount doesn't match, or the transfer hasn't appeared yet). You can upload fresh proof for the same payment without starting over — nothing already uploaded is lost.

## What happens after you pay

Your plan and quota apply **the moment the payment is verified**. There is no second step to wait for.

Your provider then issues the corresponding invoice for that payment. That's an obligation on their side and happens separately: **it never holds up your plan activation**.

You can confirm the result in the web app, or via [`GET /v1/tenants/me`](endpoints/tenant-me.md), which shows your current tier and quota.

## Renewals

An active subscription renews at the end of each billing period.

- **~7 days before** it expires you get a `SUBSCRIPTION_RENEWAL_DUE` notification and an email. A renewal payment is already open and ready to settle, by card or transfer.
- If the period lapses unpaid, there's a **~7-day grace period**. Partway through it you get a second, more urgent notice.
- If grace runs out unpaid, your account drops to the FREE tier and becomes `PAST_DUE`.

`PAST_DUE` **resolves itself**: start a new subscription from the web app, pay it, and your account returns to `ACTIVE` immediately. No need to contact support. It's distinct from `SUSPENDED`, which is a deliberate action by your provider.

## Changing plan

From the web app you can move up or down a tier, and switch between monthly and yearly billing. The rules:

| Change | When it applies | What you pay |
|---|---|---|
| **Upgrade** (same interval) | Immediately, once paid | Only the difference, prorated by the time left in your current period |
| **Downgrade** (same interval) | At the end of the current period | Nothing — the current period is already paid at the higher tier |
| **Switch monthly ↔ yearly** | At the end of the current period | Full price of the new tier+interval, never prorated |

Only one change can be pending at a time. The full history of tier changes over time is in [Tenant Events](endpoints/tenant-events.md).

## Cancelling

You can schedule a cancellation from the web app. Your plan keeps working normally until the end of the period you've already paid for; on that date the account drops to FREE. There's no refund for the remaining time.

## Price protection

If Comprobify changes your tier's price, you get **at least 30 days' notice** (a `PRICE_CHANGE_ANNOUNCED` notification and email — this one can't be turned off). Any renewal falling due before the new price's effective date is automatically billed at the old price.

## Tracking all of this over the API

Even though payment happens in the web app, you can still receive billing events programmatically:

- [Notifications](endpoints/notifications.md) — `PAYMENT_VERIFIED`, `PAYMENT_REJECTED`, `SUBSCRIPTION_RENEWAL_DUE`, `SUBSCRIPTION_PAST_DUE_WARNING`, `SUBSCRIPTION_EXPIRED`, `PRICE_CHANGE_ANNOUNCED`, pollable or delivered by [webhook](endpoints/webhooks.md).
- [`GET /v1/tenants/me`](endpoints/tenant-me.md) — your current tier, quota and account status.
- [Tenant Events](endpoints/tenant-events.md) — the full sequence of what has happened to your account.
