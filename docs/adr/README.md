# Architecture Decision Records

---

## What is an ADR?

An Architecture Decision Record (ADR) documents a significant technical decision: the context that led to it, the decision itself, and the consequences. ADRs are the answer to "why is the code like this?" — they preserve reasoning that is not visible in the code.

---

## When to write one

**Write an ADR when:**
- Choosing between two or more viable technical approaches (e.g. library A vs library B, SQL vs NoSQL)
- Making a decision that will be hard to reverse later
- Choosing a pattern that will be applied consistently across the codebase
- Deciding not to do something that seems obviously useful (the "why not" is as valuable as the "why")

**Do NOT write an ADR for:**
- Implementation details that follow obviously from the architecture (e.g. which field to add to a table)
- Decisions that are easily reversible with low cost
- Bug fixes or routine refactors

---

## ADR template

```markdown
# ADR-XXXX: [Title]

## Status
[Proposed | Accepted | Deprecated | Superseded by ADR-XXXX]

## Date
YYYY-MM-DD

## Context
[What problem were we solving? What constraints existed? What were the forces at play?]

## Decision
[What did we decide to do? Be specific.]

## Consequences

### Positive
- [benefit 1]
- [benefit 2]

### Negative
- [trade-off 1]
- [trade-off 2]

### Mitigation
[How are the negative consequences mitigated?]

### Alternatives Considered
- **[Alternative A]**: [why it was not chosen]
- **[Alternative B]**: [why it was not chosen]
```

---

## Status values

| Status | Meaning |
|--------|---------|
| `Proposed` | Under discussion — not yet implemented |
| `Accepted` | Decision made and implemented |
| `Deprecated` | Was accepted but no longer recommended |
| `Superseded` | Replaced by a newer ADR (link to it) |

---

## How to create a new ADR

1. Copy the template above into a new file: `docs/adr/NNN-short-title.md` (next sequential number)
2. Fill in all sections — `Context` and `Alternatives Considered` are mandatory
3. Set status to `Proposed` while discussing, then `Accepted` when implemented
4. **Never modify an accepted ADR** — create a new one to supersede it and update the old one's status to `Superseded by ADR-XXXX`
5. Add an entry to the table below

---

## Current ADRs

| # | Title | Status | Date |
|---|-------|--------|------|
| [001](001-layered-architecture.md) | Layered Express Architecture | Accepted | 2026-02-26 |
| [002](002-postgresql-sequential-locking.md) | PostgreSQL SELECT FOR UPDATE for Sequential Numbers | Accepted | 2026-02-26 |
| [003](003-xmllint-xsd-validation.md) | xmllint for XSD Validation | Accepted | 2026-02-27 |
| [004](004-xades-bes-signature-profile.md) | XAdES-BES Signature Profile | Accepted | 2026-02-28 |
