# Documentation Index

---

## Quick Links

### Public API documentation
- [docs.comprobify.com](https://docs.comprobify.com) — Endpoint reference, error codes, and getting started guide for API consumers

### Getting Started
- [GETTING_STARTED.md](../GETTING_STARTED.md) — Local setup from scratch

### Understanding the codebase
- [guides/code-flow.md](guides/code-flow.md) — Full request lifecycle walkthrough with architectural reasoning
- [guides/coding-guidelines.md](guides/coding-guidelines.md) — Patterns, conventions, and how to add new features
- [guides/testing-scheduled-jobs.md](guides/testing-scheduled-jobs.md) — SQL recipes to force each scheduled job's scenarios locally (cert expiry, webhook retries, subscription downgrades/renewals/expiry, quota rollover, Payphone reconciliation)
- [guides/billing-operations.md](guides/billing-operations.md) — The operator's side of billing end to end: reviewing transfers, the invoicing queue, refunds, suspensions, renewals
- [guides/payphone-payments.md](guides/payphone-payments.md) — Card payments end to end: the flow, every failure mode, and what to do about each
- [guides/repeated-attempt-detection.md](guides/repeated-attempt-detection.md) — Where repeated-attempt alerts surface and how to respond
- [guides/documentation-checklist.md](guides/documentation-checklist.md) — What documentation to update for each type of change
- [guides/updating-api-documentation.md](guides/updating-api-documentation.md) — Workflow for the public VitePress docs site
- [guides/app-b-integration-plan.md](guides/app-b-integration-plan.md) — Planning notes for bundling Comprobify into a separate product ("App B"): two invoicing relationships, partner-billing design, not yet built

### Architecture decisions
- [adr/README.md](adr/README.md) — ADR index, template, and guidelines

### Deployment
- [deployment.md](deployment.md) — Branching strategy, CI/CD, environment variables, security checklist

### Root-level files
- [README.md](../README.md) — Project overview, architecture, feature summary
- [CLAUDE.md](../CLAUDE.md) — Rules and context for AI coding assistants
- [CHANGELOG.md](../CHANGELOG.md) — Release history

---

## docs/ Directory

```
docs/
├── README.md               This file — documentation index
├── deployment.md           Production deployment guide
├── guides/
│   ├── code-flow.md        Layer-by-layer request walkthrough (the "why" behind each piece)
│   ├── coding-guidelines.md  Patterns, conventions, and step-by-step feature guide
│   ├── documentation-checklist.md  What docs to update for each change type
│   ├── updating-api-documentation.md  Workflow for the public docs site
│   ├── repeated-attempt-detection.md  Where attempt alerts surface, and how to respond
│   ├── billing-operations.md  The operator's side of billing, end to end
│   ├── payphone-payments.md  Card payments end to end, and every failure mode
│   ├── testing-scheduled-jobs.md  SQL recipes to force each cron job's scenarios locally
│   └── app-b-integration-plan.md  Planning notes for bundling Comprobify into another product (not yet built)
└── adr/
    ├── README.md           ADR index, template, and process
    ├── 001-layered-architecture.md
    ├── 002-postgresql-sequential-locking.md
    └── 003-xmllint-xsd-validation.md
```

---

## Guide Summaries

### `guides/code-flow.md`
Traces a request from `app.js` through every layer down to the database and back. Each section includes the actual code and a "why" explanation of the design decision. Read this first when onboarding to the codebase or when debugging an unexpected behaviour.

### `guides/coding-guidelines.md`
Defines the conventions for adding new features: how to structure a service, how to add a new document type, SQL injection prevention rules, error handling patterns, and test structure. Includes code examples for each pattern. Reference this when building anything new.

### `guides/billing-operations.md`
Everything between a tenant deciding to pay and you having issued them a factura: how money arrives (card vs transfer), reviewing an SPI proof and the rejection-code vocabulary, the invoicing queue and linking, renewals/grace/`PAST_DUE`, refunds and why rolling back by hand is wrong, suspending with a tenant-visible reason code, and the SQL for "they say they paid and nothing happened". The operator-facing counterpart to the tenant's billing page on the docs site.

### `guides/payphone-payments.md`
The full card-payment flow — session, widget, Payphone's five-minute auto-reversal window, confirm, activation — and then the part CLAUDE.md and the ADR don't cover: what every failure mode looks like in the data, which ones self-heal, and which need you. Includes the SQL diagnostic path for "I paid but nothing happened", and the one case that always needs manual work (a duplicate charge). Read this before touching anything card-related, and when a tenant reports a payment problem.

### `guides/testing-scheduled-jobs.md`
Step-by-step SQL recipes for forcing each of the three admin-triggered jobs (notifications, subscriptions, quota) to actually have something due, since none of them find anything against fresh data. Covers certificate expiry alerts, webhook retry exhaustion, scheduled tier downgrades, renewal reminders, subscription expiry (and why it doesn't suspend the tenant), and quota period rollover — including the yearly-vs-monthly independence guarantee.

### `guides/app-b-integration-plan.md`
Reasoning and a build plan for bundling Comprobify's invoicing into a separate product ("App B"). Covers why each end customer still needs their own Comprobify tenant (SRI's one-RUC-per-tenant constraint), why registration stays frontend-only (ADR-035 unaffected), the two independent invoicing relationships (you invoicing App B's customers vs. each customer invoicing theirs), and the not-yet-built partner-billing mechanism for activating a bundled customer's subscription without handing out full `ADMIN_SECRET`. Nothing in it is built yet — read it before starting that work, not as a description of current behavior.

### `adr/README.md`
Index of Architecture Decision Records — the significant design choices made during development, their context, and the alternatives that were considered. Start here to understand *why* the system is built the way it is, not just how.

### `deployment.md`
Branching strategy and git flow (feature branches → `main`, which deploys to staging continuously; a tag + published GitHub Release promotes to `production`), CI/CD pipeline, environment variables, `xmllint` system dependency, database migration strategy, SRI environment switching, security checklist, and log monitoring.
