# ADR-001: Layered Express Architecture

## Status
Accepted

## Date
2026-02-26

## Context

The original codebase was a single-file proof-of-concept: one Express controller that hardcoded the issuer data, read sequential numbers from a flat JSON file, and returned the signed XML directly. This approach was sufficient to prove the SRI integration worked but had several problems:

- Business logic, XML construction, signing, and HTTP handling were all mixed in one place
- Replacing the flat-file sequential store with a database required rewriting the controller
- Testing any individual step was impossible without running the full HTTP stack
- Adding new document types (credit notes, retention receipts, etc.) would have meant duplicating large sections of the controller

The redesign needed to support multiple document types, concurrent requests, PostgreSQL persistence, and testability in isolation.

## Decision

Adopt a four-layer architecture with strict one-direction dependencies:

```
Route → Validator → Controller → Service → Model / Builder / Helper
```

- **Routes** define URL paths and chain the validator array + controller
- **Validators** (`express-validator`) declare field rules declaratively — no validation logic in controllers
- **Controllers** are thin: call one service method, return one response
- **Services** own business logic and orchestration — they are the only layer that coordinates across models, builders, and helpers
- **Models** execute parameterised SQL and return raw rows — no business logic
- **Builders** construct XML document trees — no database access
- **Helpers** are low-level utilities (signing, key generation) wrapped by services

## Consequences

### Positive
- Each layer is testable in isolation — unit tests mock exactly one layer boundary
- Adding a new document type requires only a new builder + registry entry, with no changes to controllers or services
- Services can be reused by future consumers (CLI, queue worker) without any HTTP layer
- Clear place for each kind of code — no ambiguity about where a new function belongs

### Negative
- More files than a flat structure for a small API
- Requires discipline to not skip layers (e.g. call a model directly from a controller)

### Mitigation
The `docs/guides/coding-guidelines.md` makes the layer boundaries explicit with examples of correct and incorrect patterns. Code review should catch layer violations before they merge.

### Alternatives Considered
- **Flat controller structure (original)**: Fast to write but collapses under any complexity. Rejected — the project already hit its limits at the proof-of-concept stage.
- **Clean Architecture (Domain/Application/Infrastructure layers)**: Provides stronger isolation but introduces significant boilerplate (interfaces, DTOs between every layer, dependency inversion). Overkill for an API of this size and domain simplicity.
- **Single service file**: Keeping all business logic in one service module. Rejected — it would grow unbounded as document types are added.
