# Updating API Documentation

This guide explains how to update API documentation when adding, modifying, or removing endpoints. The documentation system uses **VitePress** (markdown) and **Postman collection** to serve developers and AI assistants.

## Documentation Systems

### VitePress Documentation
- **Location:** `docs/site/`
- **Format:** Markdown files
- **Deployment:** GitHub Pages (auto-deployed on push to main)
- **URL:** https://github.com/novaej/comprobify/wiki

### Postman Collection
- **Location:** `postman/comprobify.postman_collection.json`
- **Format:** JSON (Postman v2.1.0 schema)
- **Usage:** Importable into Postman, used for quick testing and sharing

### NEXT_STEPS.md
- **Location:** `NEXT_STEPS.md` (root)
- **Purpose:** Tracks remaining features and their status

## Process for Adding a New Endpoint

### 1. Create Endpoint Documentation File

Create a new markdown file in `docs/site/endpoints/` following the pattern of existing files.

**File naming:** `docs/site/endpoints/{endpoint-name}.md` (lowercase, hyphens)

**Template:**
```markdown
# Endpoint Name

Brief description of what the endpoint does.

\`\`\`
METHOD /api/path
\`\`\`

## Authentication

`Authorization: Bearer <api-key>` or describe auth requirements

## Path Parameters (if any)

| Parameter | Description |
|---|---|
| `paramName` | Description |

## Query Parameters (if any)

| Parameter | Type | Description |
|---|---|---|
| `paramName` | string/integer | Description |

## Request Body (if POST/PUT)

\`\`\`json
{
  "field": "value"
}
\`\`\`

## Response

**200 OK**

\`\`\`json
{
  "ok": true,
  "data": {}
}
\`\`\`

## Errors

| Code | Status | When |
|---|---|---|
| `CODE` | 400/401/404 | Error condition |
```

**Example:** See `docs/site/endpoints/list-documents.md`

### 2. Update Endpoints Index

Update `docs/site/endpoints/index.md` to add the new endpoint to the overview table:

```markdown
| `METHOD` | `/api/path` | Brief description |
```

**Order endpoints by:**
1. GET listing/overview endpoints first
2. POST/create endpoints
3. GET detail endpoints
4. POST/send endpoints
5. Other operations

### 3. Update VitePress Navigation

Update `docs/site/.vitepress/config.mjs` sidebar configuration to include the new endpoint:

```javascript
{
  text: 'Endpoints',
  collapsed: false,
  items: [
    { text: 'Overview', link: '/endpoints/' },
    { text: 'New Endpoint', link: '/endpoints/new-endpoint' },  // Add here
    // ... other endpoints
  ]
}
```

### 4. Update Postman Collection

Update `postman/comprobify.postman_collection.json` to add the endpoint request.

**Location in JSON structure:**
```
item[0].item[]  // "Documents" folder → items array
```

**Request template:**
```json
{
  "name": "Endpoint Name",
  "request": {
    "method": "GET",
    "url": {
      "raw": "{{base_url}}/api/path?param1=value",
      "host": ["{{base_url}}"],
      "path": ["api", "path"],
      "query": [
        { "key": "param1", "value": "value", "description": "...", "disabled": true }
      ]
    },
    "description": "What this endpoint does."
  }
}
```

**After editing:** Validate JSON with:
```bash
node -e "const fs = require('fs'); JSON.parse(fs.readFileSync('postman/comprobify.postman_collection.json')); console.log('✓ Valid JSON')"
```

### 5. Update NEXT_STEPS.md (if applicable)

If the endpoint completes a pending task in `NEXT_STEPS.md`:
- Remove the completed item
- Renumber remaining items
- Update any cross-references

### 6. Testing Documentation

Before committing:

1. **VitePress build:** `npm run docs:build`
2. **Preview locally:** `npm run docs:preview`
3. **Postman JSON:** Validate syntax and import into Postman
4. **All tests pass:** `npm test`

## Checklist for New Endpoint

- [ ] Code implemented and tested
- [ ] Endpoint documentation file created (`docs/site/endpoints/{name}.md`)
- [ ] Endpoints index updated (`docs/site/endpoints/index.md`)
- [ ] VitePress sidebar updated (`docs/site/.vitepress/config.mjs`)
- [ ] Postman collection updated (`postman/comprobify.postman_collection.json`)
- [ ] Postman JSON validated
- [ ] NEXT_STEPS.md updated (if applicable)
- [ ] All tests passing (`npm test`)
- [ ] Documentation builds successfully (`npm run docs:build`)

## Commits

Group documentation changes logically:
1. **Implementation:** `feat: add endpoint name`
2. **Documentation:** `docs: add endpoint name documentation`
3. **Tracking:** `chore: mark task as complete in NEXT_STEPS` (if applicable)

## Common Mistakes to Avoid

1. **Forgetting VitePress sidebar** — endpoint file exists but not in navigation menu
2. **Mismatched query parameter names** — Postman collection has different param names than code
3. **Invalid JSON in Postman** — collection fails to import
4. **Stale NEXT_STEPS.md** — completed items not removed, numbering out of sync
5. **Inconsistent documentation** — endpoint descriptions differ between VitePress and Postman
6. **Missing error codes** — endpoint docs don't list all possible HTTP responses

## For AI Assistants

When adding or updating endpoints, follow this exact sequence:

1. Check current documentation in all three places (VitePress, Postman, NEXT_STEPS)
2. Update code + endpoint file in `docs/site/endpoints/`
3. Update `docs/site/endpoints/index.md` table
4. Update `docs/site/.vitepress/config.mjs` sidebar
5. Update `postman/comprobify.postman_collection.json` with proper JSON formatting
6. Validate Postman JSON syntax
7. Update `NEXT_STEPS.md` if task is complete
8. Create commits in logical groups
9. Run tests: `npm test`, `npm run docs:build`

This ensures consistency across all documentation surfaces and prevents developers or AI from having to search multiple places for endpoint information.
