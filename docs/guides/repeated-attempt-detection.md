# Repeated-Attempt Detection — How It Works and How to Respond

`src/services/attempt-tracker.service.js` flags a repeated-attempt pattern against the same `(eventType, key)` pair as a signal for the operator. This is **detection, not brute-force prevention** — every secret involved at every call site (API keys, `ADMIN_SECRET`, cert fingerprints, Mailgun's HMAC signing key) is already high-entropy and computationally infeasible to guess. Nothing here stops an attacker who could plausibly succeed; the value is knowing that repeated attempts happened at all. See CLAUDE.md's "Repeated-attempt detection" entry and [ADR-026](../adr/026-redis-shared-counter-store.md) for the full design and why it's built on Redis.

This guide covers the two things CLAUDE.md doesn't: **where you'll actually see an alert**, and **what to do about it once you find one**.

---

## Where alerts show up

Two channels fire together, every time the configured threshold is crossed (`ATTEMPT_TRACKER_THRESHOLD`, default 5, within `ATTEMPT_TRACKER_WINDOW_MS`, default 15 minutes):

| Channel | What it takes to see it | How useful it is in practice |
|---|---|---|
| **Sentry** (`Sentry.captureMessage`) | `SENTRY_DSN` set in the running environment | The immediate one. Shows up in the Sentry project's **Issues** list as a `warning`-level event, tagged `eventType`, with `key`/`count` in the extra data. Filter Issues by `eventType:ADMIN_AUTH_FAILURE` (or any of the other three) to see just that category. |
| **Structured logs** (`logger.warn`, via `src/services/logger.service.js`) | Nothing to see it locally (always prints); `BETTERSTACK_SOURCE_TOKEN` set to have it shipped and queryable | Always visible via `docker compose logs api` on the droplet, or your terminal locally. Once `BETTERSTACK_SOURCE_TOKEN` is set, also queryable/aggregatable in Betterstack after the fact — e.g. "how many `ADMIN_AUTH_FAILURE` crossings this week" — which Sentry's one-off alert doesn't give you on its own. See CLAUDE.md's "Structured request logging" entry. |

**Sentry Issues is where you should look for the immediate alert.** If you want a push notification instead of checking the dashboard, set up a Sentry **Alert Rule** on the project (e.g. "notify when an event matches `level:warning`", optionally scoped to a specific `eventType` tag) — that's a one-time Sentry project configuration, not something this code does for you. For historical/aggregate queries across crossings over time, use Betterstack instead.

If `REDIS_URL` isn't set at all, none of this fires — `recordEvent()` is a silent no-op (see ADR-026's "optional, not required").

---

## What to do when you find one

There's no automated response — every one of these requires a human decision. What you're actually looking at differs by `eventType`:

### `RECOVERY_SUCCESS` — same tenant, repeated *successful* `POST /v1/recover` calls

Recovery requires the actual matching P12 certificate, so this isn't "someone guessing" — either the tenant is genuinely fumbling their own key repeatedly, or their certificate itself has leaked and someone else has it.

1. Pull `GET /v1/admin/tenants/:id/events` for that tenant — every recovery leaves a `tenant_events` row, giving you an exact timeline.
2. Contact the tenant via their registered email to confirm they made these requests.
3. If the certificate looks compromised rather than the tenant being forgetful: consider `PATCH /v1/admin/tenants/:id/status` to suspend them while you sort it out, and have them go through certificate renewal once confirmed.

### `API_KEY_AUTH_FAILURE` — same `keyHash` repeatedly failing lookup

You have the hash, not the plaintext token, but that's enough to investigate:

1. Query `api_keys` directly for that hash. If it matches a **revoked** key, you now know which tenant/label owned it (e.g. `erp`) — usually this just means a client wasn't updated after a key rotation. Reach out to that tenant.
2. If the hash matches nothing in `api_keys` at all, it's scanning of made-up tokens — not concerning on its own (it can't succeed), but worth noting if the same source is also tripping other event types.

### `ADMIN_AUTH_FAILURE` — wrong `ADMIN_SECRET`, keyed by IP

Nobody but your own ops tooling should ever be hitting `/v1/admin/*`, so this one is the most inherently suspicious of the four.

1. Check whether the source IP is one of yours first — a misconfigured deploy script, a stale CI secret, or a cron job reading an old `.env` is the common innocent cause.
2. If the IP is unrecognized/external, it's almost certainly an automated bot scanning for default admin credentials on any `/admin` path — extremely common on the public internet, and not a real risk on its own since `ADMIN_SECRET` is a 64-char hex string.
3. Still worth confirming the secret was never accidentally leaked (committed to a repo, pasted somewhere, logged) — rotate it if there's any doubt.

### `MAILGUN_WEBHOOK_INVALID_SIGNATURE` — bad HMAC, keyed by IP

1. Check Mailgun's own dashboard for webhook delivery failures around the same timestamp **first**. If real deliveries are failing there, `MAILGUN_WEBHOOK_SIGNING_KEY` in the deployed `.env` has drifted from what Mailgun is actually configured with (rotated in one place, not the other) — this is the urgent case, since it means `email_status` tracking (`documents.email_status`) is silently broken for real emails.
2. If Mailgun's own logs show no matching failures, it's just noise/scanning against the public webhook URL — low priority.

---

## General notes that apply to all four

- The Sentry event's `extra` data already has the exact `key` and `count` — no need to reconstruct anything from the message string.
- Nothing needs manual cleanup for an alert to stop repeating — the underlying Redis counter (`attempt:{eventType}:{key}`) expires on its own once the window (`ATTEMPT_TRACKER_WINDOW_MS`) elapses.
- If you decide an IP genuinely needs blocking, that's a separate manual step (a Cloudflare firewall rule, or the DigitalOcean Cloud Firewall) — this mechanism never blocks anything itself, by design (see "detection, not prevention" above).
- The threshold/window is shared across all four event types rather than tuned individually (`ATTEMPT_TRACKER_THRESHOLD`/`ATTEMPT_TRACKER_WINDOW_MS`) — expect some false positives early on. If a particular type turns out consistently noisy in practice, that's the signal to revisit the shared threshold (or split it per-type), not something to work around per-alert.
- There is no automated escalation beyond Sentry today (e.g. no operator email) — NEXT_STEPS.md's original draft floated one, but it was deliberately not built since Sentry already closes the "how will I know" gap. Revisit only if Sentry-fatigue or a high false-positive rate makes a dedicated inbox ping worth the extra code.
