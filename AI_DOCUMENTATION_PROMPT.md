# AI Documentation Generator Prompt

Use this file when asking an AI to create or update documentation for a software project.
It is **tech-stack independent** — adapt the bracketed placeholders to your project.

---

## How to use

1. Copy the prompt below (everything inside the code block).
2. Fill in the `[PROJECT CONTEXT]` section at the top with your project details.
3. Paste into your AI assistant (Claude, ChatGPT, etc.).
4. Review, refine, and commit the generated files.

---

## Prompt

```
You are a technical writer creating documentation for a software project. Generate all documents listed below following the structure, tone, and rules described. Documentation should be useful to both human developers and AI coding assistants working on the codebase.

---

## [PROJECT CONTEXT] — fill this in before sending

- **Project name**: [e.g. SalonCloud]
- **One-line description**: [e.g. Multi-tenant salon management SaaS]
- **Tech stack**: [e.g. ASP.NET Core 9, Angular 21, SQL Server, EF Core, JWT auth]
- **Architecture**: [e.g. Clean Architecture with 4 layers: Domain, Application, Infrastructure, Web]
- **Key architectural patterns**: [e.g. Multi-tenancy via BusinessId, soft deletes, feature flags, configurable workflows]
- **Frontend framework**: [e.g. Angular 21 standalone components with @ngx-translate for i18n]
- **Database setup**: [e.g. SQL Server with EF Core migrations; demo data auto-seeded in Development]
- **Deployment target**: [e.g. Azure App Service via GitHub Actions]
- **Roles / auth**: [e.g. JWT, roles: Owner, Admin, Staff, SuperAdmin]
- **Special rules**: [e.g. mobile-first CSS, all UI text must use translation keys, never accept tenant ID from client]
- **Demo credentials**: [e.g. owner@example.com / Owner@123]
- **Key features**: [list main modules, e.g. Appointments, Staff Payments, Subscriptions, Workflow Engine]
- **Shared components**: [e.g. app-btn for all labeled buttons, appFlatpickr for date inputs]
- **Other notes**: [any other conventions, constraints, or context the AI should know]

---

## Documents to generate

Generate each document below exactly as specified. Do not merge them or skip any.

---

### 1. `README.md`

**Purpose:** Architecture overview and feature reference. NOT a setup guide — setup lives in `GETTING_STARTED.md`.

**Include:**
- Project title and one-paragraph description
- Architecture diagram (ASCII) showing layers and their relationships, with a brief explanation of the dependency rule
- Core features — grouped by area, 1–2 sentences each explaining what and why
- Project directory tree (top-level, 2–3 levels deep) with one-line annotation per folder
- Authentication & authorization: how tokens work, what roles exist, what each role can do
- Key architectural patterns: explain each pattern and why it was chosen (e.g. multi-tenancy approach, soft deletes, feature flags)
- Link to `GETTING_STARTED.md` from the "Getting Started" section — do NOT inline setup steps here
- Links to all docs in `docs/guides/` and `docs/deployment.md`
- Production security checklist (bullet points)
- License

**Tone:** Confident and concise. A senior developer reading this should understand the system in 5 minutes.

---

### 2. `GETTING_STARTED.md`

**Purpose:** Get a developer running locally as fast as possible on the first try. This is the ONLY place that contains setup steps.

**Structure:**
1. Prerequisites table (tool, minimum version, install link)
2. Clone
3. Database setup — two clearly labelled options:
   - **Option A — Docker** (recommended): `docker compose up -d` + one-liner to initialize DB and user + how to set the connection string
   - **Option B — Existing [database]**: SQL/CLI commands to create DB and user + how to set the connection string
   - For the connection string itself, show two sub-options:
     - User Secrets / env file (recommended — never committed)
     - Dev config file (simpler — warn not to commit with credentials)
4. Install dependencies (backend + frontend)
5. Apply migrations (mention that demo data is seeded automatically)
6. Start the application — two terminal tabs, with URLs table at the end
7. Demo credentials table
8. Troubleshooting section: EF CLI not found, "too many open files" on macOS, reset DB, dependency issues, connection string not taking effect

**Tone:** Step-by-step, numbered, scannable. Each step should be self-contained. A developer who has never seen this project should be running it within 10 minutes.

---

### 3. `CLAUDE.md`

**Purpose:** The primary guide for AI coding assistants working in this codebase. This file is loaded automatically into AI context and must be dense, precise, and actionable. Every rule here takes precedence over AI defaults.

**Structure and content:**

#### Project Overview
- Name, one-line description, tech stack (language, framework, database, auth)

#### Common Commands
Organized by category, with inline comments:
- Running the application (frontend terminal, backend terminal, any docker commands)
- Database migrations (create + apply)
- Build (dev + production)
- Testing and linting

#### Architecture
- Layer diagram (same as README)
- Dependency rule stated explicitly
- Multi-tenancy or other cross-cutting patterns explained in 3–5 bullets

#### Entity Conventions
- What the base entity provides and requires
- Any exceptions (e.g. join tables that don't inherit from base)
- Constructor validation requirement
- Soft delete rule: never hard delete

#### Coding Standards

**CRITICAL REMINDERS section** (use bold, put at top):
List the non-negotiable rules that an AI is most likely to get wrong, e.g.:
- Mobile-first: min-width media queries, never max-width, minimum touch targets
- i18n: ALL user-facing text uses translation keys — never hardcoded strings
- Multi-tenancy: never accept tenant ID from the client — always from server context
- Architecture: specific layer boundary rules

**Backend Quick Reference:**
- Entities (what they must inherit, include, and validate)
- Controllers (required attributes, what to inject, what to return)
- Repositories (where interface lives, where implementation lives, async rules)
- EF Configuration (where to add configs, required query filter, required index)

**Frontend Quick Reference:**
- Components (standalone, required imports)
- Translations (pipe syntax, add to all language files, AlertService key rule)
- Shared components (list each shared component, when to use it, key inputs)
- Date/time inputs (which directive to use, what not to use, why)
- CSS (mobile-first pattern with code example showing ✅ good vs ❌ bad)
- Services (singleton pattern, return type, URL format)
- RxJS (unsubscribe pattern, OnDestroy rule, async pipe preference)

#### Git Commit Conventions
Use [Conventional Commits](https://www.conventionalcommits.org/):

Format: `type: short description (max 50 chars)`

Types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`, `ci`

Rules:
- Lowercase type — `feat:` not `Feat:`
- No period at end
- Imperative mood — "add feature" not "added feature"
- One concern per commit — split unrelated changes

Examples:
```
feat: add appointment reminder notifications
fix: resolve null reference in client lookup
refactor: extract client selector into shared component
docs: add workflow system guide
ci: update Azure deployment workflow
chore: upgrade Angular to 21
```

#### Common Mistakes to Avoid
Numbered list of 8–12 things the AI most commonly gets wrong in this codebase, e.g.:
1. Accepting tenant ID from client instead of reading from server context
2. Hardcoding text instead of using translation keys
3. Missing translations in all language files
4. Returning entities from controllers instead of DTOs
5. Missing authorization attribute on controllers
6. Using hard delete instead of soft delete
7. Breaking architecture layer boundaries
8. Missing required component imports (TranslateModule, etc.)
9. Using desktop-first (max-width) media queries
10. Using native date inputs instead of the locale-aware directive

#### Architecture Decision Records
- When to create an ADR
- Sequential numbering convention
- Link to `docs/adr/README.md`

#### Key Files
List 8–12 files with one-line descriptions, e.g.:
- `GETTING_STARTED.md` — local setup guide
- `docker-compose.yml` — dev database container
- `Web/Program.cs` — DI configuration
- `Web/Startup.cs` — middleware pipeline
- etc.

#### Demo Credentials
Table with role, email, password. Note that demo data auto-seeds in Development mode.

**Tone:** Directive and dense. No filler text. This file is read by an AI, not presented to a user. Every line should be a useful constraint or reference.

---

### 4. `CHANGELOG.md`

**Purpose:** Track notable changes per release.

Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format with [Semantic Versioning](https://semver.org/):

```
## [Unreleased]
## [X.Y.Z] - YYYY-MM-DD
### Added / Changed / Deprecated / Removed / Fixed / Security
```

**Rules:**
- Group entries under Added / Changed / Fixed / Removed / Security — use only the categories that apply
- Each entry is one line, written from the user's perspective ("what changed and why it matters")
- Technical implementation details go in commit messages, not here
- Start with `[Unreleased]` section, then versions in reverse chronological order
- Generate at least `[0.1.0]` as the initial release entry

---

### 5. `docs/README.md`

**Purpose:** Documentation index — the table of contents for everything in `docs/`.

**Include:**
- Quick Links section organized by audience/task:
  - Getting Started
  - Development Guides (one link per guide)
  - Deployment
- `docs/` directory tree with one-line annotation per file
- 2–4 sentence summary of each guide (what it covers, who should read it)
- Links to root-level files: `README.md`, `GETTING_STARTED.md`, `CLAUDE.md`, `CHANGELOG.md`
- Link to ADR index

Remove any references to `CONTRIBUTING.md` — contribution standards live in `CLAUDE.md` and `docs/guides/coding-guidelines.md`.

---

### 6. `docs/guides/coding-guidelines.md`

**Purpose:** The detailed, code-example-rich version of `CLAUDE.md`'s coding standards. Target audience: AI assistants and developers adding new features.

**Structure:**
- Architecture rules with a step-by-step "how to add a new feature" walkthrough (each layer in order)
- Backend patterns with full code examples:
  - Entity with constructor validation
  - Repository interface and implementation
  - Controller with correct attributes and response types
  - EF Core entity configuration (query filter, index)
  - DTO design rules
- Frontend patterns with full code examples:
  - Component skeleton (imports, standalone, translate)
  - Service skeleton (singleton, Observable return, relative URL)
  - Mobile-first CSS block (annotated with ✅ / ❌)
  - Translation key usage (template + typescript)
  - RxJS unsubscribe pattern
  - Shared component usage with all inputs shown
- Common mistakes section — match the list in `CLAUDE.md` but with an explanation and corrected code for each

**Tone:** Reference manual. Dense. Every section has code. No fluff.

---

### 7. `docs/guides/backend-setup.md`

**Purpose:** Developer guide for working on the backend.

**Include:**
- Layer responsibilities (1 paragraph per layer)
- How to add a new feature end-to-end (numbered steps)
- Multi-tenancy implementation details: how the middleware works, how to use the tenant context service
- Feature flag system: how to check flags, how to add new flags, seeder location
- EF Core: how global query filters work, how to create and apply migrations, how to reset the DB
- Repository pattern conventions
- Dependency injection: where services are registered

---

### 8. `docs/guides/frontend-setup.md`

**Purpose:** Developer guide for working on the frontend.

**Include:**
- Directory structure annotated
- How to add a new feature (component, service, route, translations)
- Shared components catalogue: each shared component, its purpose, required inputs, import path
- i18n: adding new keys, where the language files live, how to test with both languages
- HTTP interceptors: what they do, how to test errors
- State management: how services hold state with Observables, how components subscribe
- Routing and lazy loading: how routes are structured, how guards work
- CSS conventions: custom properties (CSS variables), SCSS file structure, mobile-first

---

### 9. `docs/adr/README.md`

**Purpose:** Index and template for Architecture Decision Records.

**Include:**
- What an ADR is (2–3 sentences) and why the project uses them
- When to write one (with examples of what IS and what IS NOT an ADR)
- ADR template in a code block:
  ```
  # ADR-XXXX: [Title]
  ## Status
  ## Context
  ## Decision
  ## Consequences
  ### Positive
  ### Negative
  ### Mitigation
  ### Alternatives Considered
  ```
- Status values: Proposed, Accepted, Deprecated, Superseded — and what each means
- How to create a new ADR (numbered steps)
- Rule: never modify an accepted ADR — create a new one to supersede it
- Table of current ADRs (start with at least one entry for the primary architectural pattern)

---

### 10. `docs/deployment.md`

**Purpose:** How to deploy to production.

**Include:**
- CI/CD pipeline overview (what triggers it, what steps it runs)
- Required secrets/environment variables (table: name, description, where to get it)
- How to configure each environment (development, staging, production)
- Database migrations in production (when they run, how to run manually)
- How to rollback a deployment
- Production security checklist (HTTPS, secrets management, CORS, rate limiting, logging)
- Monitoring: what to watch, where logs go
- Secrets management: where to store credentials, what NOT to put in config files

---

## Documentation quality rules

Apply these to every document generated:

1. **Separate concerns**: README = what/why. GETTING_STARTED = how to run. CLAUDE.md = rules for AI. Guides = how to build. Never duplicate content across files — link instead.
2. **No orphan content**: Every rule in CLAUDE.md that needs an example belongs in `coding-guidelines.md` with a link back.
3. **Code examples are mandatory** in CLAUDE.md, coding-guidelines.md, backend-setup.md, and frontend-setup.md.
4. **Git conventions are mandatory** in CLAUDE.md — types, format, rules, and examples. This is the most commonly overlooked item.
5. **Mobile-first is mandatory** if the project has a web UI — include a CSS example showing the correct vs incorrect pattern.
6. **All language files** — if the project has i18n, every reminder about adding text must say "add to ALL language files".
7. **No CONTRIBUTING.md** — contribution standards go in CLAUDE.md (quick rules) and docs/guides/coding-guidelines.md (detailed with examples).
8. **GETTING_STARTED must be self-contained** — a developer should be able to follow it with zero prior knowledge of the project.
9. **ADRs are immutable** — make this explicit in both the ADR README and CLAUDE.md.
10. **CHANGELOG entries are user-facing** — write what changed and why it matters, not implementation details.
11. **Avoid duplication** — if content appears in two places, move it to the authoritative location and link from the other.
12. **Keep CLAUDE.md under ~300 lines** — if it grows beyond this, move detail into coding-guidelines.md and add a link.

---

## Adapt for your project

After generating the base documents, tell the AI to customize with your specifics:
- Replace all placeholders with real values
- Add project-specific shared components to the CLAUDE.md frontend quick reference
- Add your actual ADRs (one per significant architectural decision)
- Add feature-specific guides for any complex modules (e.g. payment flows, real-time features, workflow engines)
- Update the CHANGELOG with your actual release history
- Verify all commands are correct for your environment

---

## Example context block

```
[PROJECT CONTEXT]
- Project name: TaskFlow
- One-line description: Team task and project management web app
- Tech stack: Node.js 20, Express 5, PostgreSQL 16, React 18, TypeScript, Prisma ORM
- Architecture: Layered MVC with service layer (routes → controllers → services → repositories)
- Key patterns: Soft deletes, workspace-level multi-tenancy, role-based access, event-driven notifications
- Frontend: React 18 with React Query, Zustand for state, Tailwind CSS
- Database: PostgreSQL via Prisma; migrations auto-run on deploy
- Deployment: Railway (backend + DB) + Vercel (frontend)
- Roles / auth: JWT, roles: Owner, Admin, Member, Viewer
- Special rules: always validate workspace membership before any data access, never return passwords in API responses, all dates stored as UTC
- Demo credentials: admin@demo.taskflow.io / Demo@1234
- Key features: Projects, Tasks, Comments, File Attachments, Notifications, Dashboard
- Shared components: <Button>, <Modal>, <DataTable>, <Avatar>
- Other notes: react-hook-form for all forms, zod for validation, dayjs for date formatting
```
```

---

## Tips for best results

- **Generate one document at a time** if context is limited — CLAUDE.md and coding-guidelines.md first, then the rest
- **Verify all commands** before committing — test the GETTING_STARTED steps on a clean machine if possible
- **Keep CLAUDE.md honest** — only put rules you actually enforce; too many rules the AI ignores is worse than fewer rules it follows
- **ADRs take time** — write them as you make decisions, not all at once retroactively
- **Update CHANGELOG on every release** — the best time is right before you tag a version
- **Review with a new team member** — ask someone unfamiliar with the project to follow GETTING_STARTED and flag anything that breaks or is unclear
