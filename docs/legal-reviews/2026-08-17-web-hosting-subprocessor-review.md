RESEARCH NOTES — NOT LEGAL ADVICE — REVIEW WITH A LICENSED ATTORNEY BEFORE ACTING

# Subprocessor Table Review — comprobify-web Hosting Product Change

**Direction:** Self-authored template (Comprobify is the drafting party; not a counterparty negotiation)
**Reviewed:** 2026-08-17
**Documents:** `docs/agreements/data-processing-agreement.md`, `docs/agreements/privacy-policy.md`
**Trigger:** `comprobify-web`'s hosting moved from DigitalOcean App Platform to its own DigitalOcean droplet (own Terraform config, `comprobify-web-staging`, mirroring the API's own droplet setup). Both documents' subprocessor listings name "DigitalOcean App Platform" specifically as where the web interface is hosted — no longer accurate.

---

## Bottom line

No new subprocessor, no new data flow, no new purpose. The vendor is unchanged — DigitalOcean, already named in both documents' subprocessor tables for the API's own hosting. Only the specific *product* changed (App Platform → Droplet), and both documents already describe hosting at the product level, not just the vendor level, so that specificity needs to be corrected rather than dropped.

**Issues:** 1🟢 0🟡 0🔴

---

## Term-by-term

### 🟢 DPA §6 table / Privacy Policy §4 — "DigitalOcean App Platform" subprocessor entry

**Text (DPA, current):** `| DigitalOcean App Platform | Alojamiento de la interfaz web del Servicio (comprobify-web) | Solo clientes que utilizan la interfaz web |`

**Text (Privacy Policy, current):** `**DigitalOcean App Platform** — hosting de la interfaz web del Servicio (comprobify-web) (solo Clientes que utilizan la interfaz web).`

**Checked against:** both documents already carry a separate, distinct row/bullet for bare "DigitalOcean" (the API's own hosting). `comprobify-web`'s droplet is provisioned in DigitalOcean's account under the same corporate entity as the API's droplet — same subprocessor, same jurisdiction, same data-processing terms, nothing new to disclose or flag for re-acceptance. The only thing that changed is which specific DigitalOcean product hosts the web interface.

No defect in substance — the disclosure was accurate about the *entity* the whole time, and remains so. The specific product name is what needs updating so the entry doesn't describe infrastructure that no longer exists.

**Resolution:** Rename both entries from "DigitalOcean App Platform" to "DigitalOcean," matching the label already used for the API's own hosting row. The description column already carries the differentiation that matters ("hosting of the web interface" vs. "hosting of the Service/API," and the "only clients using the web interface" qualifier) — collapsing the label to match doesn't lose any information a reader needs, since two "DigitalOcean" entries with different descriptions is exactly as precise as one "DigitalOcean" + one "DigitalOcean App Platform" entry was, now that both really are the same product.

**Applied:**
1. DPA §6 table — `DigitalOcean App Platform` → `DigitalOcean` (description/audience columns unchanged).
2. Privacy Policy §4 — `**DigitalOcean App Platform**` → `**DigitalOcean**` (description unchanged).

**Status:** source files updated (`docs/agreements/data-processing-agreement.md`, `docs/agreements/privacy-policy.md`), **not yet published** via `POST /v1/admin/agreements` — no live tenant sees this version yet, no re-acceptance has been triggered. Given the substance genuinely didn't change (same vendor, same purpose, same audience), this doesn't need to be treated as urgent the way the 2026-08-06 review's active disclosure conflict was — republish whenever convenient, e.g. bundled with the next legal-document refresh, rather than as its own rush.

---

## Recommended redlines

1. ~~DPA §6 + Privacy Policy §4 — "DigitalOcean App Platform" → "DigitalOcean" in both subprocessor listings.~~ **Applied.**

---

## If they won't move

N/A — this is our own template, not a counterparty negotiation.

---

## Next steps

- [ ] Decide when to publish the corrected DPA + Privacy Policy (`POST /v1/admin/agreements`, one new version each) — low urgency, no active conflict, bundle with the next refresh if convenient
- [ ] If `comprobify-web` ever changes hosting product again (e.g. moves off DigitalOcean entirely), re-check both documents the same way
