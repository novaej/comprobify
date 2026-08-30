RESEARCH NOTES — NOT LEGAL ADVICE — REVIEW WITH A LICENSED ATTORNEY BEFORE ACTING

# Privacy Policy Check: adding Payphone card payments for subscription fees

**Date:** 2026-08-30
**Mode:** Direct query (pre-launch, branch `feat/payphone-card-payments`)
**Bottom line:** **POLICY UPDATE REQUIRED before this ships** — 4 REQUIRED, 2 ADVISABLE.

Two of the REQUIRED items are **already live and inaccurate today** (they came from
ADR-027 / PR #197, not from this branch) and should be fixed regardless of whether
card payments ship.

---

## What's already covered

- **Legal basis.** Privacy Policy §3 grounds tenant-data processing in execution of the
  Terms of Service. Charging a subscription fee by card is squarely within that; no new
  legal basis is needed.
- **International transfer.** §4's closing paragraph already discloses that some providers
  process data outside Ecuador, and the DPA §6 carries a standing authorization. Payphone
  is Ecuadorian, so this is a non-issue either way.
- **No new data subjects.** Only tenants pay by card. Buyer data is untouched, which is
  what keeps this out of the DPA entirely (see item C).
- **Card data itself.** The payer types the card into Payphone's embedded widget; the PAN
  never reaches our servers. There is nothing to disclose because we never receive it —
  and this is worth stating affirmatively in the policy, since it is the single most
  reassuring fact about the design.

---

## REQUIRED

### R1 — §2 does not disclose card-transaction data

**Current policy (§2, last table row):**
> | Comprobante de pago (transferencia bancaria) | Del Cliente | Verificación manual de pagos de suscripción |

**Gap:** We will store `card_brand`, `card_last_digits`, `authorization_code`, Payphone's
transaction id, and `raw_confirm_response`. None is disclosed. The row also presumes the
data comes *from the Client* — card data arrives *from the processor*, a different source,
which §2's "De quién" column is supposed to capture.

**Suggested replacement row:**
> | Comprobante de pago por transferencia bancaria, o datos de la transacción cuando el pago se realiza con tarjeta (marca de la tarjeta, últimos dígitos, código de autorización e identificador de la transacción asignado por el procesador de pagos) | Del Cliente, o del procesador de pagos según el medio de pago utilizado | Verificación del pago de la suscripción, conciliación contable y atención de reclamos o reversos |

**Add below the table:**
> Comprobify **no recibe, no transmite y no almacena en ningún momento el número completo
> de la tarjeta ni su código de seguridad**. Estos datos se ingresan directamente en el
> formulario del procesador de pagos y no transitan por los sistemas de Comprobify.

### R2 — §4 does not list Payphone

**Current policy (§4):** lists DigitalOcean ×3, Mailgun, Sentry, Betterstack, CloudAMQP, SRI.
Payphone absent. Disclosing recipients is the core of §4; shipping without it is a plain
misstatement of who receives data.

Drafted entry is in R3, because *where* it goes depends on fixing R3 first.

### R3 — §4's framing calls every recipient a "subencargado". That is wrong for Payphone — and already wrong for SRI

**Current policy (§4 preamble):**
> "Los datos se almacenan y procesan utilizando los siguientes proveedores, **cada uno
> actuando como subencargado del tratamiento respecto de los datos que procesa por cuenta
> de Comprobify**…"

**Why this is the substantive finding.** A processor (*encargado*) processes only on the
controller's documented instructions. A card processor does not: Payphone runs its own fraud
screening, retains transaction records under financial-sector rules, and answers to its own
regulator. It determines its own *fines y medios* for that processing, which under LOPDP
(as under the GDPR framework LOPDP is modelled on) makes it an **independent controller**,
not our subprocessor.

Calling it a *subencargado* is not a harmless label. It is a public representation that we
direct Payphone's processing and can, for instance, instruct deletion — which we cannot.
It over-claims control we do not have.

**The same defect already exists for SRI**, which is a public authority receiving data by
legal mandate and is unambiguously its own controller. So §4's preamble is inaccurate today,
before Payphone. Fixing the framing once resolves both.

**Suggested restructure of §4** (keep every existing entry; only regroup and re-head):

> ## 4. Con quién compartimos datos
>
> **Subencargados del tratamiento.** Los siguientes proveedores tratan datos personales por
> cuenta de Comprobify y conforme a sus instrucciones, según sus propios términos de servicio
> y compromisos de confidencialidad y seguridad:
>
> *(DigitalOcean ×3, Mailgun, Sentry, Betterstack, CloudAMQP — sin cambios)*
>
> **Terceros que actúan como responsables independientes.** Los siguientes destinatarios no
> tratan datos por cuenta de Comprobify: determinan sus propios fines y medios en cumplimiento
> de obligaciones legales y regulatorias propias.
>
> - **SRI (Servicio de Rentas Internas)** — autoridad tributaria ecuatoriana receptora
>   obligatoria por mandato legal; la transmisión de comprobantes electrónicos es exigida por
>   la normativa tributaria aplicable (todos los Clientes).
> - **Payphone** — procesamiento de pagos con tarjeta de crédito o débito para el pago de la
>   suscripción del Cliente, cuando el Cliente elige este medio de pago. Los datos de la
>   tarjeta se ingresan directamente en el formulario de Payphone y no son recibidos ni
>   almacenados por Comprobify. Comprobify recibe de Payphone únicamente el resultado de la
>   transacción y los datos indicados en la sección 2. Payphone trata dichos datos como
>   responsable independiente, conforme a su propia política de privacidad y a la normativa
>   aplicable a los medios de pago (solo Clientes que pagan con tarjeta).

### R4 — ToS §4 misdescribes activation, on two counts. Already live.

**Current ToS (§4, line 35):**
> "El pago se realiza mediante transferencia bancaria manual. La activación del servicio
> ocurre una vez verificado el pago por Comprobify **y autorizado por el SRI el comprobante
> electrónico que respalda dicho pago**; este proceso puede tomar tiempo adicional después
> de verificado el pago."

Two independent defects:

1. **"transferencia bancaria manual"** — will be false once card ships.
2. **"y autorizado por el SRI el comprobante"** — this is the invoice gate **removed in
   ADR-027 (PR #197, already merged)**. Activation is immediate on payment verification.
   This sentence has been wrong in production since that merge.

**Exposure.** The direction is the safer one — we promise slower activation than we deliver,
and no customer complains about getting access early. The real risk is narrower: the clause
describes a *condition* (SRI authorization of our invoice) that no longer occurs, so it is
evidence against our own process in any billing dispute, and it undercuts the "execution of
the contract" basis Privacy Policy §3 relies on if the contract describes a process we do not
follow. Low severity, but it is a factual misstatement in a binding document and cheap to fix.

**Suggested replacement:**
> El pago puede realizarse mediante transferencia bancaria o mediante tarjeta de crédito o
> débito a través del procesador de pagos habilitado por Comprobify. La activación del Servicio
> ocurre una vez verificado el pago: tratándose de pago con tarjeta, la verificación es
> automática e inmediata tras la aprobación de la transacción; tratándose de transferencia
> bancaria, ocurre una vez que Comprobify verifica el comprobante de pago remitido por el
> Cliente. La emisión de la factura correspondiente por parte de Comprobify es posterior e
> independiente de la activación del Servicio.

The final sentence is deliberate: it forecloses any later reading that activation still
depends on the invoice.

---

## ADVISABLE

### A1 — Indefinite retention of `raw_confirm_response` conflicts with §8 and with data minimisation — **RESOLVED 2026-08-30**

Two distinct problems:

**Consistency.** §8 commits that account data including *"historial de pagos"* is deleted after
termination once no legal retention obligation applies. Indefinite retention with no pruning
job is a commitment we are not keeping.

**Minimisation.** `raw_confirm_response` stores Payphone's *entire* response body. Per their
API that can include the payer's email, phone, and cédula/RUC — none of which we need. What we
actually use for reconciliation is already in the structured columns. Storing the rest, forever,
is more than the purpose requires (LOPDP minimisation / proportionality).

Those structured columns are fine to keep: brand + last four + authorization code are exactly
what a chargeback or bank-statement match needs, and last-four-plus-brand is not restricted
cardholder data.

**Recommendation, in order of preference:**
1. Whitelist fields at write time — persist only what the reconciliation sweeps read, and drop
   the raw body entirely. Cleanest, and removes the disclosure question.
2. Failing that, prune `raw_confirm_response` to `NULL` after a fixed reconciliation window
   (90 days is comfortably beyond both sweeps), keeping the structured columns.

**RESOLUTION (2026-08-30).** Option 1 was taken, at the vendor boundary rather than the
persistence site: `payphone.service.js`'s `confirm()` filters the response through an
allow-list (`PERSISTED_FIELDS`) before returning, so no caller can log or persist what it
never receives. Allow-list, not block-list — a new field on Payphone's side is dropped by
default. Migration 092 backfills the rows written earlier and renames the column to
`confirm_response` (it is no longer raw; leaving the old name would invite someone to rely on
it as a complete record in a dispute). Verified against the live local rows: zero retain any
payer-identity key. Privacy Policy §8 now carries matching retention language, safe to publish
because the behaviour matches it.

*Original recommendation, retained for the record:*

**Do not publish retention language until one of these is built.** Drafting a pruning promise
against a system with no pruning job creates the same defect as R4 — a document describing
behaviour the product does not have. Suggested wording once it exists:

> Los datos de las transacciones de pago con tarjeta se conservan mientras subsista la relación
> con el Cliente y durante los plazos exigidos por la normativa tributaria y contable aplicable.
> La respuesta íntegra devuelta por el procesador de pagos se conserva únicamente durante el
> período necesario para la conciliación de la transacción, transcurrido el cual se conservan
> solo los datos indicados en la sección 2.

### A2 — Instant activation makes the no-refund clause bite harder

ToS §4: *"Los pagos no son reembolsables una vez procesado el pago y activado el Servicio."*
Under SPI there was a human-review gap between paying and activating. With card, payment and
activation are seconds apart, so the clause becomes effectively absolute from the moment of
the charge. That is a commercial decision, not a compliance defect — flagging it only because
the change in payment mechanics silently changed the clause's practical effect. Tenants are
businesses, so consumer-withdrawal protections are weaker here than they would be B2C.

---

## Direct answers to the questions asked

**B — processor or controller?** Independent controller. See R3. This is the finding most worth
a second opinion, and the one place where local counsel adds real value, because it is a
characterisation question under LOPDP rather than a drafting question.

**C — does Payphone belong in the DPA?** **No — do not add it.** DPA §3 defines its scope as
buyer data contained in comprobantes (plus the web buyer catalog). Payphone touches only the
Comprobify↔tenant billing relationship, where Comprobify is controller in its own right, not
the tenant's processor. Adding it to DPA §6 would wrongly imply it processes buyer data and
would drag in §6's subprocessor-notice machinery for no reason.

There is already a precedent for exactly this split: **Betterstack appears in Privacy Policy §4
but deliberately not in DPA §6**, because it logs Client request IPs rather than buyer data.
Payphone follows the same pattern — Privacy Policy yes, DPA no.

**D — does changing the ToS require advance notice?** No. The 30-day clause in §4 is
**price-specific** and does not extend to other amendments. The general amendment clause is
§11: *"Comprobify puede actualizar estos Términos. Cuando los cambios sean sustanciales, se
podrá requerir aceptación expresa"* — discretionary ("se podrá"), no fixed period. Both changes
here are neutral-to-favourable (more payment options, faster activation), so express
re-acceptance is defensible to skip.

**⚠️ But there is an operational trap — this is the one thing to get right on sequencing.**
Publishing a new `TERMS` version via `POST /v1/admin/agreements` creates a fresh `PENDING`
`tenant_agreements` row for every tenant. `hasAllAccepted()` then returns false for all of them,
and its **only** caller is `tenant.service.js:62` — `promote()`. So **every tenant's
sandbox→production promotion will 403 with `AGREEMENT_ACCEPTANCE_REQUIRED` until they
re-accept.** Nothing else breaks (documents, payments, and existing production tenants are
unaffected), but a tenant mid-onboarding would hit a wall with no warning.

Recommended sequence: publish the Privacy Policy revision and the ToS revision together, in one
window, and have comprobify-web surface the re-acceptance prompt (`GET /v1/tenants/agreements`
already reports the drift) before anyone attempts a promotion.

**E — retention.** See A1.

---

## Not raised by this change, but still open

From the 2026-08-10 sweep, **both ADVISABLE items were already applied** — the sweep note
recorded them as drafted-not-yet-applied and was never updated after they landed:

- **Per-item `detallesAdicionales` free text** — applied in a3a4ce8 (PR #180, merged 2026-08-10,
  hours after that sweep ran), and in **both** documents: Privacy Policy §2 and DPA §3 each name
  *"Campos Adicionales" (a nivel de comprobante) y "Detalles Adicionales" (a nivel de cada ítem)*
  explicitly. No action needed.
- **Redis IP-keyed counters** — applied in the same commit (Privacy Policy §6, third paragraph).
  No action needed.

*Correction: an earlier draft of this review repeated the sweep note's stale claim that the first
item was outstanding. It was not. Verify against the documents, not the sweep record.*

Also still open from the practice profile, and unrelated to this change: it is unconfirmed
whether signed DPAs exist with the current subprocessors, as opposed to reliance on their
standard terms. Comprobify's own DPA promises to tenants depend on those flow-downs. If a
Payphone agreement is being signed now anyway, it is a natural moment to check the others.

---

## Next steps

- [x] **R1–R3 applied** to `docs/agreements/privacy-policy.md`, and **R4** to `terms-of-service.md` (2026-08-30).
- [x] **A1 done** — allow-list filter at the vendor boundary + migration 092 (scrub & rename);
      Privacy Policy §8 retention language added now that the behaviour matches.
- [ ] **Publish both revised documents in one window**, then have the frontend prompt for
      re-acceptance — before any tenant attempts promotion.
- [ ] **Send the counsel brief** — `2026-08-30-counsel-brief-processor-characterisation.md`,
      written 2026-08-30. R3's edit is already applied and committed (45dd984); this asks only
      whether the characterisation was right, and settles SRI's framing at the same time.
- [x] ~~Per-item `detallesAdicionales` sentence~~ — already applied in PR #180; the sweep note
      was stale, not the documents.
- [ ] Confirm PCI scope with Payphone — an embedded widget where the PAN never reaches our
      servers is normally the lightest self-assessment tier, but that determination is theirs
      to confirm, not ours to assume.
