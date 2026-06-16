# ADR-016: Dockerfile for Production Deployment

## Status
Accepted

## Date
2026-06-16

## Context

ADR-003 chose `xmllint` (a system binary from `libxml2-utils`) for XSD validation over npm packages, which were either end-of-life or required a JVM. This was the right call for correctness and security, but it introduced a system-level dependency that the application runtime must satisfy.

Render.com's managed Node.js buildpack does not pre-install `xmllint`. Deploying to Render with the Node buildpack results in an `ENOENT` error at document creation time because `child_process.execFile('xmllint', ...)` cannot find the binary. The options considered to resolve this were:

1. **Switch to a pure-Node XSD validator** — The only actively maintained option (`libxmljs2`) is declared end-of-life by its maintainers. This was already rejected in ADR-003.
2. **Render build command with `apt-get`** — Render's Node.js buildpack does not support `apt-get` in the build command; it only runs `npm install`.
3. **Dockerfile** — Define a custom image based on `node:20-slim`, install `libxml2-utils` via `apt-get` during the image build, and let Render build and run that image instead of using the Node buildpack.

## Decision

Add a `Dockerfile` to the repository root. Render auto-detects and uses it in place of the Node.js buildpack when it is present.

The image:
- Extends `node:20-slim` (Debian slim — has `apt`, small footprint)
- Installs `libxml2-utils` (provides `xmllint`) during build via `apt-get`
- Copies `package*.json` before application code to maximise Docker layer cache reuse on deploys where only code changes
- Runs `npm ci --omit=dev` to exclude dev dependencies from the production image
- Starts with `node app.js`

No changes to application code, environment variables, deploy workflows, or Render service configuration (beyond Render switching to Docker build automatically).

## Consequences

### Positive
- `xmllint` is guaranteed to be present in every environment the image runs in — no per-host setup required
- The image is immutable and identical across all scaled instances — eliminates environment drift
- Render's scaled instances all run the same image; no per-container install step at startup
- Deploy workflows unchanged — they still just trigger Render's deploy hook
- PostgreSQL and all other external services remain outside the container; the container is stateless

### Negative
- Docker image builds are slightly slower than the Node buildpack on Render's shared build infrastructure
- The team now owns the base image choice and must update the `FROM` line on major Node.js LTS bumps
- Security patches to `libxml2` require a new image build and redeploy; with a managed runtime they would arrive automatically

### Mitigation
The build slowdown is a one-time cost per deploy, not a runtime concern. Node.js LTS transitions happen on a two-year cycle and are a one-line change. `libxml2` is a mature, stable library with infrequent security advisories.

### Alternatives Considered
- **`libxmljs2` npm package**: End-of-life, no security patches forthcoming. Already rejected in ADR-003 — the same reason applies here.
- **Render Native Node buildpack + `apt-get` in build command**: Not supported — Render's Node buildpack only runs `npm install` in the build step.
- **Skip XSD validation in production**: Rejected — validation catches malformed documents before the expensive signing step and before a round-trip to SRI. Removing it degrades the developer experience and wastes SRI quota on rejectable documents.
