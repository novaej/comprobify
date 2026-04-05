# Documentation Index

---

## Quick Links

### Public API documentation
- [novaej.github.io/comprobify](https://novaej.github.io/comprobify) — Endpoint reference, error codes, and getting started guide for API consumers

### Getting Started
- [GETTING_STARTED.md](../GETTING_STARTED.md) — Local setup from scratch

### Understanding the codebase
- [guides/code-flow.md](guides/code-flow.md) — Full request lifecycle walkthrough with architectural reasoning
- [guides/coding-guidelines.md](guides/coding-guidelines.md) — Patterns, conventions, and how to add new features

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
│   └── coding-guidelines.md  Patterns, conventions, and step-by-step feature guide
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

### `adr/README.md`
Index of Architecture Decision Records — the significant design choices made during development, their context, and the alternatives that were considered. Start here to understand *why* the system is built the way it is, not just how.

### `deployment.md`
Branching strategy and git flow (feature → main → staging → prod), CI/CD pipeline, environment variables, `xmllint` system dependency, database migration strategy, SRI environment switching, security checklist, and log monitoring.
