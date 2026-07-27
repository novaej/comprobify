RESEARCH NOTES — NOT LEGAL ADVICE — REVIEW WITH A LICENSED ATTORNEY BEFORE ACTING

# Terms of Service Review — Price Change Notice & Payment Suspension

**Direction:** Self-authored template (Comprobify is the drafting party; not a counterparty negotiation)
**Reviewed:** 2026-07-27
**Document:** `docs/agreements/terms-of-service.md`
**Trigger:** two clauses (§4's price-change notice, §4's payment suspension) were checked against actual system behavior at the start of this work — both described behavior that didn't exist in code yet at that time. The two features (ADR-023 tier price history, ADR-025 `PAST_DUE` tenant status) were built to close that gap; this review re-checks the clauses against the finished implementation.

---

## Bottom line

No open defects. Two issues found during the original gap-check, both already resolved as part of the same work this review covers — one code fix, one document fix (applied below). Confirmed a third clause (§10's termination language) that looked like it might overlap is actually already correctly scoped and needs no change.

**Issues:** 0🔴 0🟠 2🟡 (both resolved) 1🟢

---

## Term-by-term

### 🟢 §4 — "Cualquier cambio de precio será notificado... con al menos treinta (30) días de anticipación mediante correo electrónico..."

**Verified against code, line by line:**

| Clause requirement | Code |
|---|---|
| ≥30 days' notice | `config.priceChangeMinNoticeDays` (default 30) is a hard floor in `pricingService.publishPrice()` — rejects (`PRICE_NOTICE_TOO_SHORT`) anything shorter |
| Notice by **email**, not just in-app | `PRICE_CHANGE_ANNOUNCED` is the one `mandatory: true` entry in `notification-catalog.js` — the tenant cannot mute the email channel for this type, unlike every other notification type |
| Email reaches the account's own address | `emailService.sendNotificationEmail()` sends to `tenant.email` |
| A renewal inside the notice window still bills the old price | The "as-of-date" pricing rule (`pricingService.getPriceAsOf`) resolves whichever price was `PUBLISHED` and in effect on the date the billing period actually starts — `current_period_end` for a renewal, not "now" |
| A tenant not `ACTIVE` at publish time still eventually finds out | Reactivation catch-up (`notifyPendingPriceChangesForTenant` called from every place a tenant transitions to `ACTIVE`) + a periodic 5-minute reconciliation sweep over all `ACTIVE` tenants as a backstop |

No defect. Matches the clause exactly.

---

### 🟡 (resolved) `PAST_DUE → ACTIVE` recovery didn't call the price-change catch-up hook

**Found:** ADR-025's new self-service recovery path (`subscriptionService.activateIfLinked`, the moment a `PAST_DUE` tenant's fresh subscription first activates) is a fourth place a tenant transitions to `ACTIVE`, alongside the three the catch-up hook was already wired into (`registration.service.js`'s `verifyEmail`, `admin.service.js`'s `verifyTenant`/`updateTenantStatus`). It didn't call `notifyPendingPriceChangesForTenant`.

**Why it wasn't actually a compliance gap:** `pricingService.reconcilePendingPriceChangeNotifications()` re-scans *every* `ACTIVE` tenant every 5 minutes regardless of how they became `ACTIVE` — a recovering tenant would still have been caught within minutes. But it was an inconsistency with the explicit-hook-at-every-reactivation-point pattern used everywhere else, worth fixing for the same reason those three hooks exist (notify immediately rather than lean on the sweep).

**Fix applied:** `activateIfLinked` now calls `pricingService.notifyPendingPriceChangesForTenant(tenantId)` (best-effort, same try/catch pattern as the other three call sites) immediately after flipping `PAST_DUE` → `ACTIVE`. Covered by new unit tests (`subscription.service.test.js`) and documented in CLAUDE.md's "Reactivation catch-up" entry.

---

### 🟡 (resolved) §4's suspension clause didn't disclose the self-service recovery path

**Text (before):** *"Comprobify puede suspender cuentas con pagos no verificados o irregulares, previa notificación razonable."*

**Finding:** not inaccurate — everything the sentence promises is true of the `PAST_DUE` implementation (automated suspension for unverified/irregular payment, with reasonable prior notice via `SUBSCRIPTION_PAST_DUE_WARNING`, 2 days before the restriction, on top of the `SUBSCRIPTION_RENEWAL_DUE` reminder 7 days before that). But the clause said nothing about how the Client gets back in, even though `PAST_DUE` was specifically designed to be self-resolving (pay and you're back, no support ticket) rather than requiring an admin. Given the very next paragraph (the price-change clause above) goes out of its way to spell out exactly how the Client is protected, the suspension clause read inconsistently terse by comparison, and a Client reading only this document would reasonably assume suspension requires contacting support to lift, which is not true.

**Fix applied:** added one sentence — *"El Cliente puede recuperar el acceso a la cuenta iniciando una nueva suscripción y completando el pago correspondiente, sin necesidad de contactar a soporte."* — to `docs/agreements/terms-of-service.md` §4. This is a **source-file edit only** — it does not publish a new version. Publishing (`POST /v1/admin/agreements`) is a separate, deliberate step that starts the re-acceptance flow for every tenant (`tenant_agreements` regenerates as `PENDING`, gates `POST /v1/tenants/promote` again) and should be triggered intentionally, not as a side effect of this review.

---

### 🟢 §10 — "...en caso de incumplimiento... uso fraudulento, abuso del sistema, **impago reiterado** o actividades ilícitas" — confirmed no overlap, no change needed

Checked whether this termination-section clause (`SUSPENDED`, admin-invoked, no self-service) conflicts with or duplicates §4's payment-suspension clause (`PAST_DUE`, automated, self-service). It doesn't — the two clauses already describe two genuinely different scenarios, and the ToS's own wording draws exactly the line the implementation does:

- §4: "pagos no verificados o irregulares" — a single unpaid/unverified renewal → `PAST_DUE`.
- §10: "impago reiterado" — **repeated** non-payment, grouped with fraud/abuse/illegal activity as for-cause grounds for suspend-**or-terminate** → `SUSPENDED`, which the system has no automated trigger for (an admin would invoke this manually via `PATCH /v1/admin/tenants/:id/status` after observing a pattern across multiple `PAST_DUE` cycles).

The ToS already anticipated this two-tier structure before either was implemented. No wording change needed here.

---

## Recommended redlines

None outstanding — both fixes (code + document) from this review are already applied as of this session.

---

## If they won't move

N/A — self-authored template, not a counterparty negotiation.

---

## Next steps

- [x] Fix `activateIfLinked` to call the price-change catch-up hook on `PAST_DUE` → `ACTIVE` recovery
- [x] Add the self-service recovery disclosure sentence to `terms-of-service.md` §4
- [ ] Publish the updated ToS version (`POST /v1/admin/agreements`) when ready — deliberately not done as part of this review; triggers re-acceptance for every tenant
- [ ] (Carried from the 2026-07-21 DPA/Privacy Policy review) Have local Ecuadorian counsel confirm the ToS liability cap is enforceable against individual-consumer Clients under consumer-protection law — unrelated to this review's findings, still open from last time
