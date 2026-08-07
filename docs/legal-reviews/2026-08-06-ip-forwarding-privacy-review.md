RESEARCH NOTES — NOT LEGAL ADVICE — REVIEW WITH A LICENSED ATTORNEY BEFORE ACTING

# Privacy Policy Review — Visitor-IP Forwarding & Per-Request Logging

**Direction:** Self-authored template (Comprobify is the drafting party; not a counterparty negotiation)
**Reviewed:** 2026-08-06
**Document:** `docs/agreements/privacy-policy.md`
**Trigger:** shipped a feature (backend `comprobify`'s `src/middleware/trusted-forwarded-ip.js`, frontend `comprobify-web`'s client-forwarding) letting the web frontend forward the real end-user visitor's IP to the API for calls it proxies server-side (registration, recovery, agreements acceptance) — that IP lands in `tenant_agreements.ip` as consent evidence. Checked the policy against this change, which surfaced an unrelated tripwire the 2026-07-21 review had already flagged in advance (see below).

---

## Bottom line

The feature itself needed no policy change — already covered. But it prompted checking a sentence the 2026-07-21 review explicitly flagged as a future tripwire, which had since gone off: Structured Request Logging (`request-logger.js`) shipped after that review, and Privacy Policy §6's "we don't log per-request IPs" claim became false the moment `BETTERSTACK_SOURCE_TOKEN` was configured on staging. Fixed same-day, source only (not yet published).

**Issues:** 0🟢 1🟡 (open) 1🔴 (resolved)

---

## Term-by-term

### 🟢 §2 table / §6 — IP/user-agent as consent evidence

**Text:** "Dirección IP y user-agent del Cliente ... Evidencia de aceptación al aceptar los Términos de Servicio, la Política de Privacidad o el DPA."

**Checked against:** the new forwarding mechanism resolves the *real* visitor IP (previously: the BFF's own shared DigitalOcean App Platform egress IP) into the exact same `tenant_agreements.ip` column, for the exact same stated purpose. No new data category, no new purpose, no new subprocessor (both DigitalOcean App Platform and the API's own DigitalOcean hosting were already named in §4) — the policy is written at the right level of abstraction (doesn't describe the internal header/BFF mechanics, nor should it).

No defect. If anything, this fix makes practice match the promise for the first time — before it shipped, the disclosure was arguably inaccurate for every tenant using the web frontend, since the recorded IP was never actually theirs.

---

### 🔴 (resolved) §6 — "no per-request IP log" claim contradicted by Structured Request Logging

**Text (before fix):** "Comprobify no mantiene un registro de la dirección IP de cada solicitud individual a la API."

**Predicted by the 2026-07-21 review** (`2026-07-21-dpa-privacy-policy-review.md`, "Privacy policy consistency" section): *"this is accurate today (no request-logging infrastructure exists yet)... If that item ships, this sentence becomes false and the policy will need a follow-up edit at that time."* That item (`request-logger.js`, CLAUDE.md's "Structured request logging") has since shipped — it logs an `ip` field on every HTTP request, and staging already has `BETTERSTACK_SOURCE_TOKEN` configured, so those lines actively ship to and are retained in Betterstack (a third-party SaaS not named anywhere in §4). This is a live, active conflict, not a silent gap — the policy makes an affirmative negative claim the system was actively contradicting.

**Resolution options considered:**
- **A. Update the policy to match practice** — disclose per-request IP logging + add Betterstack to §4 + state the actual retention window.
- **B. Change practice to match the policy** — strip `ip` from what ships to Betterstack specifically, keep the stronger "no persistent per-request trail" claim. Better fit for the stated Conservative risk posture, but requires a `logger.service.js` code change.

**Decision: Option A.** Confirmed actual Betterstack retention on the current (free) plan: **3 days**.

**Applied:**
1. §4 — added: *"Betterstack — plataforma de registro (logging) para monitoreo operativo y diagnóstico de errores; puede incluir la dirección IP de cada solicitud a la API, conforme a lo descrito en la sección 6 (todos los Clientes)."*
2. §6 — replaced the conflicting sentence (and dropped "únicamente" from the preceding sentence, which had the same problem in miniature — IP is no longer recorded *only* at acceptance) with: *"La dirección IP y el user-agent del Cliente se registran al momento de aceptar los Términos de Servicio, la Política de Privacidad o el DPA, como evidencia de dicha aceptación. Adicionalmente, con fines de seguridad y diagnóstico operativo, la dirección IP de cada solicitud individual a la API se incluye en los registros técnicos del Servicio, los cuales se conservan durante un período máximo de tres (3) días, transcurrido el cual se eliminan de forma automática."*

**Note:** DPA §6's subprocessor table was *not* touched — confirmed `request-logger.js`'s logged fields (`timestamp`/`method`/`path`/`statusCode`/`durationMs`/`ip`/`requestId`/`keyHash`/`apiKeyId`/`tenantId`/`issuerId`) contain no buyer PII, so this is a Privacy Policy-only (Client-data) disclosure, outside the DPA's buyer-data-only scope (§2 "Objeto").

**Status:** source file updated (`docs/agreements/privacy-policy.md`), **not yet published** via `POST /v1/admin/agreements` — no live tenant sees this version yet, no re-acceptance has been triggered.

---

### 🟡 (open) §8 — retention silent on the consent-evidence record itself

**Issue:** §8's general account-data retention promise ("Comprobify atenderá solicitudes de supresión una vez terminada la relación con Comprobify, siempre que no existan obligaciones legales que requieran su conservación") doesn't carve out the IP/user-agent-as-consent-evidence record from ordinary account data. If ever honored literally post-termination, Comprobify would lose its own proof that a former tenant validly accepted the Terms/Privacy/DPA — the same evidentiary problem the tax-retention carve-out already exists to prevent for invoice data, for a different underlying reason (contract-dispute evidence, not tax law).

**Suggested language (not yet applied):**
> *Add to §8, after the buyer-catalog paragraph:*
> "La dirección IP y el user-agent registrados como evidencia de aceptación de los Términos de Servicio, la Política de Privacidad o el DPA (sección 6) se conservan independientemente de la terminación de la cuenta, en la medida necesaria para acreditar dicha aceptación ante una eventual controversia contractual."

**Why not applied now:** no active deletion mechanism exists yet (§8 says "atenderá solicitudes," not automatic deletion) — lower urgency than the conflict above, which was live today. Deferred to the next policy refresh.

---

## Recommended redlines

1. ~~§4 + §6 — disclose per-request IP logging via Betterstack, correct retention.~~ **Applied.**
2. §8 — add the consent-evidence retention carve-out (Gap above). Not yet applied.

---

## If they won't move

N/A — this is our own template, not a counterparty negotiation.

---

## Next steps

- [ ] Decide when to publish the updated Privacy Policy (`POST /v1/admin/agreements`, `documentType: PRIVACY`, new version) — will flag existing tenants for re-acceptance
- [ ] Consider outside counsel review before publishing, given this closes an active (if brief) disclosure/practice conflict, not just routine tightening
- [ ] Apply the §8 retention carve-out at the next policy refresh
- [ ] If Betterstack's plan/retention ever changes, §6's "tres (3) días" needs a matching update — new tripwire, same pattern as the one this review closed
