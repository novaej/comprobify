RESEARCH NOTES — NOT LEGAL ADVICE — REVIEW WITH A LICENSED ATTORNEY BEFORE ACTING

# DPA & Privacy Policy Review — Comprobify

**Direction:** Self-authored templates (Comprobify is the Processor/Encargado; not a counterparty negotiation)
**Reviewed:** 2026-07-21
**Documents:** `docs/agreements/data-processing-agreement.md`, `docs/agreements/privacy-policy.md`
**Reference:** Terms of Service review, same date (`docs/agreements/terms-of-service.md`, findings already applied)

---

## Bottom line

One real defect (🔴) — the DPA's own acceptance clause contradicts how acceptance actually works in the product, and now also contradicts the just-corrected Terms of Service. One real disclosure gap (🟠) — a live production subprocessor isn't listed. Everything else is minor tightening or flags for confirmation outside what I can verify from this codebase.

**Issues:** 0🟢 3🟡 1🟠 1🔴

---

## Term-by-term

### 🔴 DPA §10 — acceptance mechanism contradicts the actual product and the corrected ToS

**Text:** "Este DPA... se considera aceptado por el Responsable al aceptar dichos Términos" (deemed accepted upon accepting the Terms of Service).

**Actual system:** `tenant_agreements` tracks `PENDING`/`ACCEPTED` status **independently per document type** (TERMS, PRIVACY, DPA). `hasAllAccepted()` requires all three to be **separately, expressly accepted** before a tenant can promote to production. Accepting the ToS does not accept the DPA — this was exactly the error already fixed in `terms-of-service.md` §1 earlier today, which now reads: acceptance of Terms, Privacy Policy, and DPA happens "como un paso posterior a la creación de la cuenta."

The DPA's own text now directly contradicts the ToS it's supposed to be consistent with. Left as-is, this creates a real enforceability question: is the DPA (which is what gives Comprobify lawful basis to process buyer data on the tenant's instruction) actually in force for a tenant who accepted the ToS but hasn't yet separately accepted the DPA? The product says no; the document says yes.

**Recommended fix:** align with the corrected ToS language — describe DPA acceptance as its own express step, not automatic from ToS acceptance.

---

### 🟠 Missing subprocessor: CloudAMQP

**Gap:** Neither Privacy Policy §4 nor DPA §6's subprocessor table lists CloudAMQP, the RabbitMQ broker used for async SRI submission (ADR-019, live in production). Both tables list Render, Neon, Mailgun, Sentry, SRI, Vercel only.

**Why this matters:** the documents' own established practice is to disclose infrastructure subprocessors even when data exposure is minimized — Sentry is listed with an explicit note that it's "configurado para minimizar el tratamiento de datos personales." CloudAMQP fits the same pattern: I checked `document-transmission.service.js` (lines 186-219) and confirmed the queued message payload is `{ documentId, accessKey, issuerId, sandbox }` — identifiers only, no buyer name/address/email — but by the same logic that got Sentry listed, this should be disclosed too. The subprocessor table appears to predate the RabbitMQ architecture (ADR-019) and was never updated after.

**Recommended fix:** add a CloudAMQP row to both tables — e.g., "Enrutamiento de mensajes para el procesamiento asíncrono de comprobantes (identificadores de documento únicamente, sin datos del comprador) — todos los Clientes."

---

### 🟡 DPA §6 — subprocessor-change notice is narrower than it reads at a glance

**Text:** "El Encargado notificará al Responsable con razonable antelación antes de incorporar un nuevo subencargado que **implique una nueva transferencia internacional de datos**."

**Issue:** read literally, a new subprocessor that does *not* involve a new international transfer (e.g., a domestic Ecuadorian vendor) triggers no notice obligation at all. That's probably not the intent — the spirit of the clause seems to be "we'll tell you before we add anyone new," with the international-transfer language meant to flag the specific case that also implicates cross-border transfer consent, not to gate notice generally.

**Recommended fix:** broaden to notice on any new subprocessor, with the international-transfer point called out as an additional specific disclosure within that notice, not the trigger for it.

---

### 🟡 Vendor-side DPA coverage unknown

Comprobify is the *controller* in its relationship with Render, Neon, Mailgun, Sentry, Vercel, and (pending the fix above) CloudAMQP. Whether Comprobify has actual signed DPAs/data-processing terms with each of these — as opposed to relying on their standard ToS — was unconfirmed during setup (marked `[UNKNOWN]` in the new practice profile). This isn't a document defect, but it's the thing the DPA's own promises to tenants (documented-instructions-only processing, breach notification, transfer control) actually rest on. Worth confirming/collecting.

---

### 🟡 Buyer-catalog deletion mechanism — unverifiable from this repo

Both documents promise that a buyer-catalog entry (comprobify-web only) is deletable on request, distinct from tax-retained invoice data. I could not verify an actual delete endpoint for a single catalog entry — comprobify-web is a separate repository not in scope for this review. Worth a quick confirmation there before relying on the promise operationally.

---

## Privacy policy consistency

🟡 **Flags, not contradictions:**
- Subprocessor list matches word-for-word between the DPA and Privacy Policy (good) — but both share the same CloudAMQP omission above, so fixing one without the other would create a new inconsistency. Fix both together.
- Privacy Policy §6 states "Comprobify no mantiene un registro de la dirección IP de cada solicitud individual a la API" — this is accurate **today** (no request-logging infrastructure exists yet — see `NEXT_STEPS.md` item 6, not yet built). If that item ships, this sentence becomes false and the policy will need a follow-up edit at that time. No action needed now, just noting the tripwire.

---

## Recommended redlines

1. **DPA §10** — replace the automatic-acceptance-via-ToS sentence with express, independent-acceptance language matching the corrected ToS §1; also switch "cancelarse dicha cuenta" → "darse de baja dicha cuenta" to match the ToS §10 terminology fix from earlier today.
2. **DPA §6 + Privacy Policy §4** — add a CloudAMQP row to both subprocessor tables.
3. **DPA §6** — broaden the subprocessor-change notice trigger to any new subprocessor, not just ones involving a new international transfer.

---

## If they won't move

N/A — these are our own templates, not a counterparty negotiation. All three redlines are within the operator's own authority to make.

---

## Next steps

- [ ] Apply redlines 1-3 above to `data-processing-agreement.md` / `privacy-policy.md`
- [ ] Confirm vendor-side DPA coverage (Render, Neon, Mailgun, Sentry, Vercel, CloudAMQP) — add to `NEXT_STEPS.md` if not already covered
- [ ] Confirm buyer-catalog per-entry deletion endpoint exists in comprobify-web
- [ ] (Carried from the ToS review) Have local Ecuadorian counsel confirm Art. 55 Código Tributario is the correct anchor for *data retention* specifically, and whether the ToS liability cap is enforceable against individual-consumer Clients under consumer-protection law
