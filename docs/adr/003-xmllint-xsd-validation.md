# ADR-003: xmllint for XSD Validation

## Status
Accepted

## Date
2026-02-27

## Context

SRI validates each submitted XML document against its published XSD schema at reception time. A schema-invalid document is rejected with a SOAP fault that is difficult to interpret and arrives only after the signing step (expensive crypto) and a network round-trip to SRI's servers.

Pre-validating locally before signing gives callers a fast, actionable 400 error with the specific XSD violations, and avoids wasting time on a document SRI will reject.

The Node.js XSD validation ecosystem is sparse:

- **`libxmljs2`** — the most widely used option, but declared end-of-life by its maintainers with no security patches forthcoming
- **`libxmljs2-xsd`** — wraps `libxmljs2`, same maintenance problem
- **`xsd-schema-validator`** — actively maintained but requires a JVM on the server
- **`xmllint`** — the command-line tool from `libxml2`, the same C library that underpins the npm packages above, maintained by the OS on every standard Linux distribution and macOS

## Decision

Use `xmllint` via `child_process.execFileSync` instead of any npm package:

```js
execFileSync('xmllint', ['--noout', '--schema', XSD_PATH, tmpFile], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
```

The XML is written to a temp file (required by `xmllint --schema`), validated, and the temp file is deleted in a `finally` block. Validation errors are parsed from stderr.

## Consequences

### Positive
- Zero npm footprint — no native addon to rebuild when Node.js upgrades
- Actively maintained by the OS — security patches arrive automatically with system updates
- Same underlying C library (`libxml2`) as the npm alternatives — identical validation behaviour
- The `factura_V2.1.0.xsd` import of `xmldsig-core-schema.xsd` resolves correctly via the filesystem without any workarounds

### Negative
- `xmllint` must be installed on every machine that runs the application (developer laptops and servers)
- Spawning a child process adds a small overhead vs in-process validation
- Validation is synchronous (blocking) for the duration of the `xmllint` call

### Mitigation
`xmllint` is pre-installed on macOS and available in a single package install on Linux (`apt install libxml2-utils`). This is documented in `GETTING_STARTED.md` as a prerequisite and in `deployment.md` as a production requirement. The child process overhead is negligible compared to the signing step that follows.

### Alternatives Considered
- **`libxmljs2`**: End-of-life, no security patches. Rejected — security vulnerabilities in a signing component are unacceptable.
- **`xsd-schema-validator`**: Actively maintained but requires a JVM. Rejected — adds a heavy runtime dependency for a single feature.
- **Skip XSD validation**: Let SRI validate at reception. Rejected — signing is expensive and SRI error messages are difficult to map back to specific fields.
- **Pure-JS XML validation**: No npm package provides full XSD 1.0 validation in pure JavaScript. Not viable.
