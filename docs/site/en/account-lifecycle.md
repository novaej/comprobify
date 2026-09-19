# Your account & the web app

Creating your account, verifying your email, recovering access, accepting the legal agreements, and going to production all happen **in the Comprobify web app**, not through the API. This page explains how each step works and what to expect. To pay for your subscription, see [Your subscription & billing](paying-your-subscription.md).

::: tip Why not through the API?
These actions are reserved for the web app: a direct API call gets `403 INTERNAL_SERVICE_ONLY`. This is deliberate. Each RUC can only be registered once, registration is a guided flow that needs your `.p12` certificate, accepting the legal agreements has to be recorded as an action you took, and your account's internal key is never exposed.
:::

## Creating your account

Sign up in the web app with your RUC, your issuer details, and your electronic-signature `.p12` certificate (**BANCO CENTRAL** and **SECURITY DATA** formats). You can optionally upload your business logo (PNG, JPEG or GIF, up to 500 KB), which appears in the header of your RIDEs.

When you're done you have:

- An issuer (branch and issue point), with your certificate stored encrypted.
- A sandbox key that the web app uses internally to run your dashboard. **It is never shown to you.**
- The **FREE** plan. All your documents go to the SRI test environment until you go to production, and sandbox testing doesn't count against your quota.

Each RUC can only be registered once. If you already have an account, use recovery (below).

## Verifying your email

The web app sends an email to the address you registered with, linking to its own verification page — click it there to activate your account. The link expires after 24 hours by default.

If you never received it or the link expired, ask for a new one from the web app (it can be resent once per minute).

Until you verify your email you can issue sandbox documents, but you **cannot** create extra branches, mint keys, register webhooks, start a subscription, or go to production. Attempting any of those returns `403 EMAIL_VERIFICATION_REQUIRED`.

## Recovering your account

If the web app shows your account as unlinked, use its recovery flow: upload the same `.p12` certificate you registered with. If it matches, your account is linked again. For your security:

- **Every active key in the current environment (sandbox or production) is revoked** and a new internal key is issued for the web app. If you had named keys for your integrations (Starter and up), they stop working — mint new ones from the dashboard.
- Your account goes back to pending email verification and a notice is sent to the registered address, with the link to confirm it. If you were not the one who recovered the account, **do not click** the link and contact support right away: someone may have your certificate. The recovery is recorded in your account's event history. The same restrictions as above apply until you confirm it (extra branches, new keys, webhooks, a new subscription), but **issuing and querying documents keeps working** in your current environment — including production if you're already there.

If your account was already linked and you only want to confirm the certificate is the right one, the web app detects that and leaves your keys and status untouched.

## Accepting the legal agreements

When you register, your personalized documents are generated — **Terms of Service**, **Privacy Policy**, and **Data Processing Agreement (DPA)** — with your business name and RUC filled in. You review and accept them in the web app, which records who accepted, when, and from where.

- Accepting them is required to go to production.
- When Comprobify publishes a new version of a document, the web app tells you and you accept it again. The history of versions you accepted is kept.
- If the operator has the legal documents turned off on the deployment you're on, you're not asked to accept anything and promotion doesn't require it.

## Going to production

After verifying your email, accepting the agreements, and testing your integration in sandbox, promote your account from the web app. Promotion is **one-way** — there is no going back to sandbox. On success:

- **All your branches go to production at once** — there is no per-branch promotion. You can set the starting sequential number for each issuer and document type; any you don't set start at `1`.
- **All active sandbox keys are revoked** and a matching production key is created for each, with the same label.
- The web app shows you the text of each production key that corresponds to a named key you created — **once only, so copy them then** and hand each to the integration that used the sandbox key with the same label. They are not shown again; if you lose one, mint another from the dashboard and revoke the old one. Your account's internal key is never shown.
- All subsequent documents, for any branch, are sent to the SRI **production** environment (`ambiente = 2`) and count against your quota.

You can also pick a paid plan when you promote; promotion never waits on payment. If a subscription was already in progress it's reused, and if it was active its billing period restarts on the promotion date. See [Your subscription & billing](paying-your-subscription.md).

## If you see `INTERNAL_SERVICE_ONLY`

A call of yours reached an action reserved for the web app: creating the account, verifying the email, recovering it, accepting the legal agreements, going to production, or managing your subscription and payments. Do it from the web app; the API offers no direct way to do it, and there is nothing to configure on your side.

For everything else — issuing and querying documents, managing issuers, keys, and webhooks — you do use the API directly. See [Getting Started](getting-started.md).
