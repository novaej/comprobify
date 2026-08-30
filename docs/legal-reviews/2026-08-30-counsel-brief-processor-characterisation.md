RESEARCH NOTES — NOT LEGAL ADVICE — PREPARED FOR REVIEW BY A LICENSED ATTORNEY

# Counsel brief: is a card processor an *encargado* or a *responsable independiente*?

**Prepared:** 2026-08-30 · **For:** Ecuadorian counsel, LOPDP
**Estimated scope:** one short written opinion. No document drafting required — the
change has already been made; this asks whether it was made correctly.

---

## The question

Comprobify's Privacy Policy §4 lists everyone who receives personal data. Until now it
described every recipient with one sentence: *"cada uno actuando como subencargado del
tratamiento respecto de los datos que procesa por cuenta de Comprobify."*

We have just split that list in two, on the view that a payment processor and a tax
authority are **not** processing on our behalf and on our instructions, but determining
their own purposes and means:

| Group as now published | Members |
|---|---|
| *Subencargados del tratamiento* | DigitalOcean (×3), Mailgun, Sentry, Betterstack, CloudAMQP |
| *Terceros que actúan como responsables independientes* | SRI, Payphone |

**Is that split correct under LOPDP, and is "responsable independiente" the right term
for each of the two entries in it?**

---

## Why it matters (what turns on the answer)

1. **It is a public representation of control we may not have.** Calling Payphone our
   *encargado* tells the public we direct its processing and can, for instance, instruct
   erasure. We cannot: Payphone retains transaction records under its own financial-sector
   obligations and would refuse such an instruction.
2. **It drives what contract we need.** If Payphone is our *encargado*, we owe our tenants
   an adequate flow-down agreement with it and must notify them of it as a subprocessor
   addition. If it is an independent controller, we do not — disclosure in the Privacy
   Policy is the obligation, not a processing agreement.
3. **The same reasoning governs SRI**, which has been on this list since the policy was
   written. If the split is wrong, it is wrong for a recipient we have been describing
   incorrectly for far longer than Payphone has existed.

---

## The facts

**What Payphone does.** Tenants (Ecuadorian businesses) pay their own Comprobify
subscription. Card details are entered directly into Payphone's embedded widget
("Cajita de Pagos") in the browser. Payphone captures the charge; we call their confirm
API server-side to learn the outcome.

**What we send Payphone:** an amount in cents, a short reference string, our own random
transaction id, and our store credentials. **No personal data.**

**What we never receive:** the card number or security code. These are entered into
Payphone's form and do not transit our systems at any point.

**What we receive and keep:** transaction id, status, authorization code, card brand and
last four digits. Payphone's response also echoes the payer's email, phone and cédula;
we filter these out at the boundary and do not retain them.

**Whose data is it.** Only tenants pay this way — the tenant is our customer, and for
tenant account data Comprobify is *Responsable*, not *Encargado*. This flow never touches
the buyer/invoice data for which Comprobify is the tenant's *Encargado*. That is why
Payphone has deliberately **not** been added to our tenant-facing DPA.

**What SRI does.** Receives electronic invoices we transmit on the tenant's instruction.
Reception is compulsory under Ecuadorian tax law; SRI is not selected by us, cannot be
replaced, and does not act on our instructions.

---

## Our reasoning, for you to confirm or correct

The distinction we applied is the ordinary one: an *encargado* processes only on the
controller's documented instructions, while a party that determines its own *fines y
medios* is a *responsable* in its own right. On that test:

- **Payphone** decides its own fraud screening, its own retention, and its own regulatory
  reporting. It is subject to payment-sector supervision independent of anything we ask of
  it. We cannot instruct it to stop, delete, or process differently.
- **SRI** is a public authority receiving data by legal mandate. It is the clearer case.

We have **not** attempted to verify this against LOPDP's own article numbering. The only
legal-research tool available here covers U.S. primary law, not Ecuadorian law, so the
citation work is genuinely yours.

---

## Specific questions

1. Is the *encargado* / *responsable independiente* split correct for each of the two
   entries, under LOPDP as applied in Ecuador?
2. Is *"responsable independiente"* the right label, or does LOPDP/its reglamento use a
   different term of art we should adopt? (For SRI, is a "destinatario por mandato legal"
   framing more accurate than a controller framing?)
3. Which LOPDP articles should §4 cite, if any? The policy already cites Art. 15 for the
   erasure exception, so citing here would be consistent.
4. If Payphone **is** an independent controller: do we owe tenants anything beyond the
   Privacy Policy disclosure — a notice, an updated ToS clause, or anything at contract
   level with Payphone itself?
5. If Payphone is instead an *encargado*: what would an adequate agreement with them need
   to contain, and does their standard merchant contract plausibly satisfy it?
6. Does the answer change because the payer is a business rather than a consumer?

---

## Related question, lower priority

Our own DPA promises tenants that subprocessors process only on documented instructions,
with breach notification and controlled international transfers. It is **unconfirmed
whether signed data-processing terms exist** with the providers in the *subencargados*
group, as opposed to reliance on their published standard terms. If reliance on standard
terms is not sufficient under LOPDP, that is a larger gap than the characterisation
question above, and we would want to know.

---

## What we will do with the answer

- **Confirmed as-is** → no further change; this note is filed as the record of why.
- **Wrong split** → revert §4 to a single group, or re-label per your wording, and revisit
  whether Payphone belongs in the tenant DPA after all.
- **Different term of art** → adopt it in both the Privacy Policy and the DPA, which share
  this vocabulary.

Documents for reference: `docs/agreements/privacy-policy.md` §4,
`docs/agreements/data-processing-agreement.md` §3 and §6. Full internal review:
`docs/legal-reviews/2026-08-30-payphone-card-payments.md`.
