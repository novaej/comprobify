# Documentation Checklist

When making changes to the codebase, update the corresponding documentation places listed below. Use this checklist to avoid gaps.

---

## By Change Type

### Adding a New API Endpoint

**Code files:**
- ✅ `src/routes/{resource}.routes.js` — add the route
- ✅ `src/controllers/{resource}.controller.js` — add the controller method
- ✅ `src/services/{resource}.service.js` — add the service logic
- ✅ `src/validators/{resource}.validator.js` — add validation chain
- ✅ `src/models/{resource}.model.js` — add DB queries if needed
- ✅ Apply middleware: rate limiting if authenticated, validators, errorHandler

**Documentation files:**
1. **`docs/site/endpoints/{endpoint-name}.md`** — create new endpoint documentation
   - Include: method, path, auth, params, request body, response, errors
2. **`docs/site/endpoints/index.md`** — add to endpoints overview table
3. **`docs/site/.vitepress/config.mjs`** — add to sidebar navigation
4. **`postman/comprobify.postman_collection.json`** — add request (validate JSON after)
5. **`CHANGELOG.md`** — add to "### Added" section in Unreleased
6. **`NEXT_STEPS.md`** — update if this completes a pending task (remove/renumber)
7. **Tests** — `tests/unit/` and `tests/integration/` as appropriate

**Checklist:**
- [ ] Endpoint documentation created
- [ ] Endpoints index updated
- [ ] VitePress sidebar updated
- [ ] Postman collection updated + JSON validated
- [ ] CHANGELOG updated
- [ ] NEXT_STEPS.md updated (if applicable)
- [ ] Tests passing

---

### Modifying an Existing Endpoint

**Code files:**
- ✅ Update the route, controller, service, validators, or models

**Documentation files:**
1. **`docs/site/endpoints/{endpoint-name}.md`** — update if request/response changed
2. **`postman/comprobify.postman_collection.json`** — update the request + validate JSON
3. **`CHANGELOG.md`** — add to "### Changed" section in Unreleased
4. **`README.md`** — update Core Features if behavior changed significantly

**Checklist:**
- [ ] Endpoint documentation updated
- [ ] Postman collection updated + JSON validated
- [ ] CHANGELOG updated
- [ ] README updated (if significant behavior change)
- [ ] Tests passing

---

### Adding a New Error Code or Response Format

**Code files:**
- ✅ `src/errors/{error-name}-error.js` — new error class if needed
- ✅ Error handler middleware to format the response

**Documentation files:**
1. **`docs/site/errors/{error-code}.md`** — create error documentation
   - Include: when it happens, how to resolve, example response
2. **`docs/site/errors/index.md`** — add to "All error codes" table
3. **`docs/site/.vitepress/config.mjs`** — add to Error Reference sidebar
4. **`docs/site/getting-started.md`** — mention if it's a user-facing error (429, 401, etc.)
5. **`CHANGELOG.md`** — add to "### Added" section in Unreleased
6. **`.example.env`** — add any new config (e.g., `MAILGUN_WEBHOOK_SIGNING_KEY`)

**Checklist:**
- [ ] Error documentation created
- [ ] Errors index updated
- [ ] VitePress sidebar updated
- [ ] Getting Started guide updated (if user-facing)
- [ ] CHANGELOG updated
- [ ] .example.env updated (if config added)

---

### Adding Middleware (Cross-Cutting Feature)

**Code files:**
- ✅ `src/middleware/{middleware-name}.js` — create middleware
- ✅ `src/routes/*.js` — apply middleware to affected routes
- ✅ `src/config/index.js` — add config if tunable

**Documentation files:**
1. **`CLAUDE.md`** — update "Architecture" section (middleware list)
2. **`CLAUDE.md`** — update "Key Patterns" section (explain the pattern)
3. **`CLAUDE.md`** — update "Key Files" section (describe the middleware)
4. **`docs/guides/code-flow.md`** — update middleware chain description
5. **`.example.env`** — add config variables with comments
6. **`README.md`** — update "Project Structure" middleware list
7. **`README.md`** — update "Core Features" if it's a significant feature (e.g., rate limiting)
8. **`docs/site/getting-started.md`** — mention if developers need to know about it
9. **`CHANGELOG.md`** — add to "### Added" section in Unreleased
10. **Tests** — `tests/unit/middleware/` for the middleware logic

**Checklist:**
- [ ] CLAUDE.md Architecture updated
- [ ] CLAUDE.md Key Patterns updated
- [ ] CLAUDE.md Key Files updated
- [ ] code-flow.md middleware chain updated
- [ ] README.md Project Structure updated
- [ ] README.md Core Features updated (if significant)
- [ ] .example.env updated
- [ ] getting-started.md updated (if needed)
- [ ] CHANGELOG.md updated
- [ ] Tests passing

---

### Adding a New Document Type (Feature)

**Code files:**
- ✅ `src/builders/{document-type}.builder.js` — new builder class
- ✅ `src/builders/index.js` — register in builder registry
- ✅ `src/validators/invoice.validator.js` — add type code to `isIn([...])`
- ✅ `src/services/xml-validator.service.js` — add schema selection
- ✅ `assets/{doctype-name-version}.xsd` — download and add XSD file

**Documentation files:**
1. **`docs/guides/coding-guidelines.md`** — update "Adding a new document type" section if steps changed
2. **`NEXT_STEPS.md`** — remove from item #2 list and renumber
3. **`CHANGELOG.md`** — add to "### Added" section in Unreleased
4. **`README.md`** — update "Core Features" if describing invoice types

**Checklist:**
- [ ] Builder class created
- [ ] Builder registered
- [ ] Validator updated
- [ ] XSD validator updated
- [ ] XSD file added
- [ ] coding-guidelines.md updated (if needed)
- [ ] NEXT_STEPS.md updated
- [ ] CHANGELOG.md updated
- [ ] Tests passing

---

### Fixing a Bug

**Code files:**
- ✅ Fix the bug in relevant file(s)

**Documentation files:**
1. **`CHANGELOG.md`** — add to "### Fixed" section in Unreleased
2. **`docs/guides/code-flow.md`** or **`docs/guides/coding-guidelines.md`** — update "Common Mistakes to Avoid" if it prevents the bug
3. **`CLAUDE.md`** — update "Common Mistakes to Avoid" section if it prevents the bug
4. **Affected endpoint docs** — clarify behavior if the bug affected API contract

**Checklist:**
- [ ] Bug fixed in code
- [ ] CHANGELOG.md updated
- [ ] Common Mistakes sections updated (if applicable)
- [ ] Endpoint documentation clarified (if behavior changed)
- [ ] Tests passing

---

### Refactoring (No Behavior Change)

**Code files:**
- ✅ Refactor the code

**Documentation files:**
1. **`CHANGELOG.md`** — add to "### Changed" section in Unreleased (optional for internal refactors)
2. **`docs/guides/code-flow.md`** or **`docs/guides/coding-guidelines.md`** — update architecture explanations if the refactor changes how things work internally
3. **`CLAUDE.md`** — update "Key Files" if file paths or layer boundaries changed

**Checklist:**
- [ ] CHANGELOG.md updated (if notable)
- [ ] code-flow.md or coding-guidelines.md updated (if explanation changed)
- [ ] CLAUDE.md updated (if structure changed)
- [ ] Tests passing

---

### Adding/Updating Configuration

**Code files:**
- ✅ `src/config/index.js` — add config variable

**Documentation files:**
1. **`.example.env`** — add env var with comment explaining what it does
2. **`GETTING_STARTED.md`** — add setup instructions if user needs to set it
3. **`docs/deployment.md`** — add to environment variables section if it's deployment-related
4. **`CLAUDE.md`** — mention in "Key Patterns" if the config enables a significant pattern
5. **`CHANGELOG.md`** — add to "### Added" section in Unreleased

**Checklist:**
- [ ] .example.env updated
- [ ] GETTING_STARTED.md updated (if user-facing)
- [ ] docs/deployment.md updated (if deployment-related)
- [ ] CLAUDE.md updated (if it enables a pattern)
- [ ] CHANGELOG.md updated

---

### Updating Error Messages

**Code files:**
- ✅ Update error message in code

**Documentation files:**
1. **Affected error documentation** — `docs/site/errors/{error-code}.md`
2. **Localization reference** — if the error message has a code for i18n, check `docs/site/errors/index.md` examples

**Checklist:**
- [ ] Error documentation updated
- [ ] Localization code documented (if applicable)

---

## Documentation Files Master List

| File | Purpose | Update When |
|------|---------|-------------|
| **API Consumer Docs** | | |
| `docs/site/endpoints/{name}.md` | Individual endpoint docs | Adding/modifying endpoint |
| `docs/site/endpoints/index.md` | Endpoints overview table | Adding/modifying endpoint |
| `docs/site/errors/{code}.md` | Individual error docs | Adding/updating error code |
| `docs/site/errors/index.md` | Error codes table + format | Adding error code or changing format |
| `docs/site/getting-started.md` | API consumer quickstart | Adding user-facing feature or config |
| `docs/site/.vitepress/config.mjs` | VitePress sidebar nav | Adding endpoint or error page |
| **Internal Architecture Docs** | | |
| `CLAUDE.md` | Rules for AI assistants | Any significant architecture change |
| `CLAUDE.md` - Architecture section | Middleware/layer list | Adding middleware |
| `CLAUDE.md` - Key Patterns | Core patterns explanation | Adding cross-cutting feature |
| `CLAUDE.md` - Key Files | File descriptions | Modifying key files or adding important new ones |
| `CLAUDE.md` - Common Mistakes | Anti-patterns to avoid | Finding bugs caused by mistakes |
| `docs/guides/code-flow.md` | Request lifecycle walkthrough | Changing middleware chain or layer behavior |
| `docs/guides/coding-guidelines.md` | Patterns for building features | Adding document type or new pattern |
| **Project Docs** | | |
| `README.md` - Architecture | System diagram | Changing architecture significantly |
| `README.md` - Core Features | Feature list | Adding significant feature |
| `README.md` - Project Structure | Directory layout + files | Adding middleware or key file |
| `docs/deployment.md` | Deployment & branching guide | Adding deployment config or env vars |
| `docs/README.md` | Docs index/navigation | Adding new doc category |
| **Configuration** | | |
| `.example.env` | Environment template | Adding any env var |
| **Tracking** | | |
| `CHANGELOG.md` | Release history | Every code change |
| `NEXT_STEPS.md` | Pending features | Completing a feature |
| **Testing** | | |
| `tests/unit/` | Unit tests | Changing business logic |
| `tests/integration/` | Integration tests | Changing API contracts |
| **API Testing** | | |
| `postman/comprobify.postman_collection.json` | Postman requests | Adding/modifying endpoint |

---

## Quick Reference by File

### `CLAUDE.md` — Update For:
- Adding middleware (Architecture section)
- Adding significant feature (Key Patterns)
- Adding important file (Key Files)
- Discovering anti-pattern (Common Mistakes)

### `docs/guides/code-flow.md` — Update For:
- Changing middleware chain
- Adding middleware
- Changing request lifecycle

### `docs/guides/coding-guidelines.md` — Update For:
- Adding new document type
- Discovering anti-pattern
- Changing how features are built

### `.example.env` — Update For:
- Adding ANY config variable
- Changing default values

### `CHANGELOG.md` — Update For:
- Every code change (at least)
- Use sections: Added, Changed, Fixed, Deprecated, Removed

### `docs/site/` — Update For:
- Adding/modifying endpoint (create .md, update index, sidebar, Postman)
- Adding/modifying error (create .md, update index, sidebar)
- Significant user-facing change (getting-started.md)

### `README.md` — Update For:
- Adding middleware to list
- Adding significant feature to Core Features
- Major architectural change

### `NEXT_STEPS.md` — Update For:
- Completing a pending feature from the list

---

## Validation Steps

After updating documentation:

```bash
# Build API docs (VitePress)
npm run docs:build

# Validate Postman JSON
node -e "const fs = require('fs'); JSON.parse(fs.readFileSync('postman/comprobify.postman_collection.json')); console.log('✓ Valid JSON')"

# Run all tests
npm test

# Check for broken links (optional, local preview)
npm run docs:preview
```

---

## Notes

- **Order matters for Postman edits**: Update the route first, then update Postman with the actual JSON structure.
- **VitePress sidebar is strict**: If you add a doc file but forget to add it to the sidebar, it won't be discoverable.
- **CHANGELOG dates**: Use today's date when adding to Unreleased; dates are assigned at release time.
- **NEXT_STEPS.md renumbering**: Keep items numbered 1, 2, 3... If you complete item 3, renumber remaining items.
- **Commit atomicity**: Group related changes (code + docs) in a single commit if they're conceptually one change.
