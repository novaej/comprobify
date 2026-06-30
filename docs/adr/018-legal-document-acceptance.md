# ADR-018: Markdown-Sourced Legal Documents with Per-Type Acceptance Audit Trail

## Status
Accepted

## Date
2026-06-30

## Context

Comprobify needed Terms of Service, Privacy Policy, and DPA acceptance tracked somewhere — and needed to decide where. The API is consumed both by a first-party frontend and by third-party systems integrating directly against `POST /v1/register`, so embedding the documents only in a frontend (with the API blindly trusting a `termsVersion` string) would leave any non-frontend integrator with nothing authoritative to check against or display.

Once the API became the source of truth for the documents themselves, two further questions followed. First, what format to store: the documents are authored and reviewed as Markdown (`docs/legal/*.md`, iterated on extensively via git diffs), and the obvious alternative — storing a final PDF — would mean every wording change requires manually re-exporting and re-uploading a file, and would make the stored artifact harder to diff/review than the source it came from. Second, how to record acceptance: a naive design stores one `accepted_at`/`version` pair per tenant, overwritten on every acceptance — which loses history (no way to prove what a tenant accepted six months ago) and can't detect a single document type changing independently (e.g. republishing only the DPA) without forcing every other document to bump in lockstep.

## Decision

**Markdown is the only stored content; HTML is always rendered on demand, never persisted.** `legal_documents` stores `content_markdown` (TEXT) and a SHA-256 `content_hash`, never PDF bytes. `legal-document.service.js`'s `renderHtml()` converts to HTML via `markdown-it` at request time. This keeps exactly one source of truth — there's nothing to keep in sync between a stored markdown copy and a stored HTML/PDF copy, and publishing a wording fix is "paste the updated text," not "re-export and re-upload a file."

**`markdown-it` over `marked` or `remark`.** All three were evaluated. `marked` dropped CommonJS support entirely at v16 (pure ESM); using it meant permanently pinning to the last CJS-compatible major version (v15) rather than tracking current releases. `remark`'s own `package.json` declares `"type": "module"` — no CJS export at all, not even via a legacy entry point. `markdown-it` ships native dual CJS/ESM exports at its current version, requires no pinning, and was verified to handle the actual GFM-style tables our documents use (the subencargados lists) without additional plugins.

**Acceptance is an append-only event log, not an overwritten field.** `legal_acceptances` (one row per `tenant_id` + `document_type` + acceptance event, carrying `version`, `content_hash`, `ip`, `user_agent`, `accepted_at`) replaces what would otherwise be a single overwritten `tenants.legal_version` column as the actual audit trail. A single signup checkbox writes three rows in one call (`legal-acceptance.service.js`'s `recordAcceptance()`) — TERMS, PRIVACY, and DPA logged independently, even though the user only clicked once. `tenants.legal_accepted_at`/`legal_version` are kept only as a denormalized "latest at a glance" cache for cheap reads on `GET /v1/tenants/me`; `legal_acceptances` is what `GET /v1/tenants/legal-status` actually queries.

**Per-type tracking, not a single bundled version.** Because each document type's latest acceptance is tracked independently, republishing the DPA alone (without touching ToS/Privacy text) is detected on its own — `legal-acceptance.service.js`'s `getStatus()` compares the tenant's latest row per type against what's currently published per type, and returns exactly which type(s) drifted. An earlier iteration of this design used a single "whichever document was published most recently" bundle version as a workaround for the same problem; the event-table design supersedes it directly rather than needing that heuristic.

**DPA acceptance has no separate UI flow.** The DPA's own text states it is accepted by virtue of accepting the ToS (incorporation by reference) — there is still only one checkbox. `recordAcceptance()` logs a DPA row in the same call as TERMS/PRIVACY regardless, so the audit trail captures it even though no DPA-specific UI exists or is needed.

**Validation against the published bundle happens server-side, not just client-side.** `POST /v1/register` and `POST /v1/tenants/accept-legal` both call `validateTermsVersion()`, which checks the submitted `termsVersion` against the currently published `TERMS` row before accepting it — rejecting with `LEGAL_VERSION_MISMATCH` on drift. This is skipped only when nothing has been published yet (pre-launch), so self-service registration isn't permanently blocked before the operator publishes the first real documents.

## Consequences

### Positive
- A tenant's full acceptance history survives indefinitely — proving "what did this tenant accept and when" for a dispute doesn't depend on a field that gets overwritten on the next re-acceptance.
- A DPA-only update is detectable and re-acceptable without forcing an unrelated ToS/Privacy version bump, and without any "newest of three wins" heuristic.
- Publishing a document is "edit Markdown, call one admin endpoint" — no PDF authoring tool, no manual export step, no binary file to keep in sync with the reviewed text.
- `markdown-it` tracks its current upstream release; no dependency frozen on an old major version to keep CommonJS compatibility.

### Negative
- No PDF generation exists yet. The public document endpoint serves HTML, and there's no "downloadable evidence of acceptance" artifact beyond the `legal_acceptances` row itself (version + hash + timestamp + IP/UA).
- `renderHtml()`'s `{{token}}` placeholder substitution exists as infrastructure (e.g. for a personalized DPA copy with a Client's actual name) but isn't wired into any endpoint yet — built ahead of a concrete use case.
- Three `legal_acceptances` rows are written per acceptance event even though, today, only one checkbox exists — slightly more data than the current UI strictly requires, in exchange for the per-type detection this ADR is built around.

### Mitigation
The deferred PDF generation is a deliberate scope cut, not an oversight — see "Alternatives Considered" below. The unused placeholder substitution is a thin, already-tested primitive (string replace + a markdown render call); wiring it into an actual personalized-document endpoint later is additive, not a redesign. The extra acceptance rows are cheap (a handful of small inserts on a low-frequency action) and are exactly what makes per-type drift detection possible without a heuristic.

### Alternatives Considered
- **Store PDF as the canonical artifact** (the original implementation of this feature): rejected after building it — every wording fix required manually re-exporting and re-uploading a file, which doesn't match how these documents are actually authored and reviewed (as Markdown, via git diffs).
- **`marked` for Markdown rendering**: built first, then replaced — v16+ is ESM-only, and this project is CommonJS throughout. Staying on `marked` meant permanently pinning to its last CJS-compatible major version (v15) rather than tracking current releases; `markdown-it` needs no such pin.
- **`remark`/`unified` ecosystem**: considered for its plugin-based extensibility (GFM tables via `remark-gfm`, etc.), rejected — its `package.json` declares `"type": "module"`, no CommonJS export exists at all, not even a legacy one.
- **Single overwritten `tenants.legal_version` field** (the original implementation): rejected after building it — loses acceptance history on every re-acceptance, and can't represent "tenant accepted ToS v3 and Privacy v3 but hasn't re-accepted DPA v4" without conflating all three into one string.
- **"Newest of three documents wins" bundle version** (an intermediate implementation, before the event table): used `getCurrentSnapshot()` to treat whichever of TERMS/PRIVACY/DPA was published most recently as "the" version to check against. Worked, but was a heuristic standing in for what per-type tracking does directly and more precisely; superseded once `legal_acceptances` existed.
- **Server-rendered PDF now** (via Puppeteer or a hand-rolled `pdfkit` markdown renderer): deferred. The actual legally-relevant evidence (version, content hash, timestamp, IP, user agent) is already fully captured in `legal_acceptances` without a PDF; a PDF would only be a presentation layer on top of that same data, and no client has asked for a downloadable one yet. Puppeteer also bundles a full Chromium binary, a heavier operational footprint than this project carries anywhere else. Build it when an actual request for one arrives, reusing the HTML rendering this ADR already establishes.
