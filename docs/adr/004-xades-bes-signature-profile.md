# ADR-004: XAdES-BES Signature Profile

## Status
Accepted

## Date
2026-02-28

## Context

Ecuador's SRI requires electronic invoices to be digitally signed using XAdES-BES (XML Advanced Electronic Signatures — Basic Electronic Signature), embedded as an enveloped `<ds:Signature>` element inside the invoice XML.

The initial implementation produced signatures that SRI rejected with `FIRMA INVALIDA`. The root causes were identified by comparing the produced signature against a known-good authorized invoice from another system:

1. **Hash algorithm**: The initial implementation used SHA-1 throughout. The reference authorized invoice used RSA-SHA256.
2. **Number of References**: The initial implementation included 3 References in `<ds:SignedInfo>` (the document body, KeyInfo, and SignedProperties). The reference invoice had only 2.
3. **KeyInfo content**: The initial implementation included `<ds:RSAKeyValue>` (modulus + exponent) inside `<ds:KeyInfo>`. The reference invoice had only `<ds:X509Certificate>`.
4. **Namespace pollution**: The initial implementation declared `xmlns:ds` and `xmlns:xsi` on the root `<factura>` element. Because inclusive C14N inherits all in-scope namespace declarations, these propagated into the canonical form of `<ds:SignedInfo>` and its descendants, producing different byte sequences than what was signed and causing the digest to not match.
5. **Issuer DN format**: The initial implementation joined issuer attributes with `", "` (comma-space). Java-based SRI tools produce `","` (comma, no space), and the reference invoice used that format.
6. **Single vs double quotes**: `js2xmlparser` defaulted to single-quoted XML attributes (`id='comprobante'`). C14N normalises attributes to double quotes, so the digest of the document body computed during signing did not match what SRI's verifier computed after canonicalising the received document.

## Decision

Adopt the following XAdES-BES profile, derived from a known-authorized invoice:

**Algorithms:**
- Signature: `http://www.w3.org/2001/04/xmldsig-more#rsa-sha256` (RSA-SHA256)
- Digest (all References and cert digest): `http://www.w3.org/2001/04/xmlenc#sha256`
- Canonicalization: `http://www.w3.org/TR/2001/REC-xml-c14n-20010315` (Inclusive C14N 1.0)

**SignedInfo structure — exactly 2 References:**
1. `URI="#comprobante"` — the invoice body, with enveloped-signature transform
2. `Type="http://uri.etsi.org/01903#SignedProperties"` `URI="#Signature…-SignedProperties…"` — the XAdES SignedProperties block

**KeyInfo:** `<ds:X509Certificate>` only — no `Id` attribute, no `<ds:RSAKeyValue>`.

**Namespace handling:** `xmlns:ds` and `xmlns:xsi` are removed from the root `<factura>` element. The signer injects `xmlns:ds` and `xmlns:etsi` directly on the element string being digested (simulating inclusive C14N scope without a full C14N library). This ensures only the namespaces declared on `<ds:Signature>` itself appear in the canonical form of its descendants.

**Issuer DN:** attributes joined with `","` (no space after comma) in reverse order (C → O → OU → CN), matching the format produced by Java-based signing tools that SRI validators were built against.

**XML serialisation:** `js2xmlparser` configured with `format: { doubleQuotes: true }` so attribute values use double quotes, matching C14N output.

## Consequences

### Positive
- Signatures are accepted by SRI (`AUTORIZADO` responses confirmed in test environment).
- RSA-SHA256 is stronger than SHA-1 and aligns with current cryptographic best practice.
- Fewer References (no KeyInfo reference) simplifies the signature structure.

### Negative
- The C14N namespace injection is a string-manipulation approximation, not a full C14N transform. It works for the specific structure of SRI invoices but could fail for documents with more complex namespace usage.
- The profile is derived empirically from a reference invoice rather than from an official SRI technical specification document. SRI does not publish a definitive XAdES-BES profile for Ecuador.

### Mitigation
- `scripts/verify-signature.js` provides offline XAdES-BES verification to catch regressions without sending to SRI.
- The signature structure is stable for the single document type currently supported (factura `01`). If new document types are added, the same signer is reused — they all produce the same `<ds:Signature>` wrapper.

### Alternatives Considered
- **Keep SHA-1**: SRI's older documentation implied SHA-1. Rejected — confirmed invalid in practice; reference authorized invoice used SHA-256.
- **3 References (include KeyInfo)**: Original implementation. Rejected — reference invoice had 2; SRI rejected the 3-Reference variant.
- **Full C14N library (`xml-c14n` npm)**: Would replace the string-injection approximation with a correct C14N transform. Not adopted — adds a dependency and complexity for a structure that is simple and static. If namespace handling becomes a problem, this is the migration path.
- **Declare namespaces on root element**: Simpler XML authoring. Rejected — inclusive C14N propagates them into every descendant's canonical form, causing digest mismatches when SRI's verifier canonicalises sub-elements independently.
