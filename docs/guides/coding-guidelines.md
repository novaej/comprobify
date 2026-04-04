# Coding Guidelines

Conventions and patterns for working in this codebase. Every section has code examples. Follow these when adding new features or fixing bugs.

---

## Architecture rules

**Layer boundary — never skip a layer:**

```
Route → Validator → Controller → Service → Model / Builder / Helper
```

- Controllers call services. Never call models directly from controllers.
- Services call models, builders, and helpers. Never import `req` or `res`.
- Models only execute SQL. No business logic.

**How to add a new endpoint end-to-end:**

1. Add the SQL migration in `db/migrations/NNN_description.sql`
2. Run `npm run migrate`
3. Create or update the model in `src/models/`
4. Create or update the service in `src/services/`
5. Add the validator chain in `src/validators/`
6. Add the controller method in `src/controllers/`
7. Register the route in `src/routes/`
8. Add unit tests for the service and model

---

## Document state transitions

When a service operation changes document status, use `assertTransition` instead of a manual `if` check:

```js
const { assertTransition } = require('../constants/document-state-machine');
const DocumentStatus = require('../constants/document-status');

// ✅ correct — uses the canonical state machine
assertTransition(document.status, DocumentStatus.RECEIVED);

// ❌ never do this — duplicates the state graph in ad-hoc logic
if (document.status !== DocumentStatus.SIGNED) {
  throw new AppError('...', 400);
}
```

`assertTransition(from, to)` throws `AppError(400)` with `"Invalid state transition: X → Y"` if the transition is not in the allowed graph defined in `src/constants/document-state-machine.js`. The same graph is enforced at the DB level by `trg_document_state_transition`.

---

## Adding a new document type

The builder registry makes this a five-step process:

**1. Create the builder** — extend `BaseDocumentBuilder`:

```js
// src/builders/credit-note.builder.js
const BaseDocumentBuilder = require('./base.builder');

class CreditNoteBuilder extends BaseDocumentBuilder {
  constructor(issuer) {
    super(issuer, '04'); // SRI document type code
  }

  build(body, accessKey, sequential) {
    this.buildInfoTributaria({ accessKey, sequential });
    // build credit-note-specific sections...
    return this.toXml('notaCredito');
  }
}

module.exports = CreditNoteBuilder;
```

**2. Register it** in `src/builders/index.js`:

```js
const builders = {
  '01': InvoiceBuilder,
  '04': CreditNoteBuilder, // add here
};
```

**3. Add the XSD** for the new document type to `assets/` (download from SRI).

**4. Update `xml-validator.service.js`** to select the correct schema by document type code.

**5. Add the type code** to the `isIn([...])` list in `src/validators/invoice.validator.js` (`documentType` field — this field is **required** on every `POST /api/documents` call; there is no default).

---

## Models

All queries use parameterised placeholders — no string interpolation, ever:

```js
// ✅ correct
const { rows } = await db.query(
  'SELECT * FROM documents WHERE access_key = $1',
  [accessKey]
);

// ❌ never do this
const { rows } = await db.query(
  `SELECT * FROM documents WHERE access_key = '${accessKey}'`
);
```

Use `db.query()` for single statements. Use `db.getClient()` when you need an explicit transaction:

```js
// explicit transaction example
const client = await db.getClient();
try {
  await client.query('BEGIN');
  // ... queries ...
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

Model functions accept plain objects with camelCase keys and return raw PostgreSQL row objects (snake_case). The service layer is responsible for any mapping.

---

## Services

Services are plain async functions — no classes. They orchestrate models, builders, and helpers:

```js
// src/services/example.service.js
const someModel = require('../models/some.model');
const AppError = require('../errors/app-error');

async function doSomething(id) {
  const record = await someModel.findById(id);
  if (!record) {
    throw new NotFoundError('Record');
  }
  // ... business logic ...
  return result;
}

module.exports = { doSomething };
```

Never import `req`, `res`, or anything from `src/routes/` inside a service.

---

## Controllers

Controllers are thin — one call to the service, one response:

```js
const doSomething = async (req, res) => {
  const result = await someService.doSomething(req.params.id);
  res.json({ ok: true, result });
};
```

All async controllers are wrapped with `asyncHandler` in the route definition — never add try/catch inside a controller.

---

## Validators

Add validator chains in `src/validators/`. Use `express-validator` `body()`, `param()`, and `query()` functions:

```js
const { body, param } = require('express-validator');

const createSomething = [
  body('name').notEmpty().isLength({ max: 300 }).withMessage('Name is required'),
  body('amount').isNumeric().withMessage('Amount must be numeric'),
];

module.exports = { createSomething };
```

Register the chain and `validateRequest` middleware before the controller in the route:

```js
router.post('/', createSomething, validateRequest, asyncHandler(controller.create));
```

---

## Error handling

Use the typed error classes — never call `res.status()` directly in a service:

```js
const AppError = require('../errors/app-error');            // HTTP status-based defaults
const NotFoundError = require('../errors/not-found-error'); // 404
const ValidationError = require('../errors/validation-error'); // 400, carries errors[]
const ConflictError = require('../errors/conflict-error');   // 409
const SriError = require('../errors/sri-error');             // 502, carries sriMessages[]

// throw from anywhere — the error handler middleware catches it
throw new NotFoundError('Document');
throw new ValidationError([{ field: 'buyer.email', message: 'Invalid email', code: 'buyer.email' }]);
throw new SriError('SRI service unavailable', sriMessages);
throw new AppError('Invalid state for this operation', 400); // code derived from status → BAD_REQUEST
```

All errors are serialised as [RFC 7807 Problem Details](../adr/011-rfc7807-error-format.md) with `Content-Type: application/problem+json`:

```json
{
  "type":     "/problems/not-found",
  "title":    "Not Found",
  "status":   404,
  "code":     "NOT_FOUND",
  "detail":   "Document not found",
  "instance": "/api/documents/123abc/send"
}
```

The `code` field is a stable SCREAMING_SNAKE_CASE key for client i18n lookups. `AppError` derives `code`, `type`, and `title` automatically from the HTTP status (see `src/errors/app-error.js`). `ValidationError` and `SriError` override with domain-specific values.

For `ValidationError`, each item in `errors[]` also carries a `code` derived from the field path with array indices stripped (`items[0].taxes[1].code` → `items.taxes.code`):

```json
{
  "type":   "/problems/validation-error",
  "title":  "Validation Failed",
  "status": 400,
  "code":   "VALIDATION_FAILED",
  "detail": "Validation failed",
  "instance": "/api/documents",
  "errors": [
    { "field": "buyer.email", "message": "Buyer email is required", "code": "buyer.email" }
  ]
}
```

---

## Audit events

Log a `document_events` row for every meaningful state change:

```js
const documentEventModel = require('../models/document-event.model');

// signature: create(documentId, eventType, fromStatus, toStatus, detail)
await documentEventModel.create(document.id, 'STATUS_CHANGED', 'RECEIVED', 'AUTHORIZED', {
  authorizationNumber: result.authorizationNumber,
});
```

Use these event types: `CREATED`, `SENT`, `STATUS_CHANGED`, `ERROR`, `REBUILT`, `EMAIL_SENT`, `EMAIL_FAILED`. Always log an `ERROR` event in the catch block before re-throwing.

---

## Tests

Unit tests live in `tests/unit/` mirroring the `src/` structure. Mock all dependencies — never hit the real database or SRI in a unit test:

```js
// tests/unit/services/example.service.test.js
jest.mock('../../../src/models/some.model');
jest.mock('../../../src/models/document-event.model');

const someModel = require('../../../src/models/some.model');
const documentEventModel = require('../../../src/models/document-event.model');
const exampleService = require('../../../src/services/example.service');

describe('ExampleService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    documentEventModel.create.mockResolvedValue({});
  });

  test('throws NotFoundError when record does not exist', async () => {
    someModel.findById.mockResolvedValue(null);
    await expect(exampleService.doSomething(99)).rejects.toThrow('not found');
  });
});
```

Run tests:

```bash
npm run test:unit          # unit tests only (fast, no DB)
npm run test:integration   # requires test PostgreSQL DB
npm test                   # all tests
```

---

## Naming conventions

- **Files:** kebab-case — `document-event.model.js`, `access-key.service.js`
- **Variables/functions:** camelCase
- **Database columns:** snake_case (PostgreSQL convention)
- **Language:** English for all identifiers, file names, table names, column names. Spanish only where SRI requires it (XML element names like `infoTributaria`, `claveAcceso`, SOAP payloads)
- **Document type codes:** use the SRI string codes (`'01'`, `'04'`) not aliases

---

## Common mistakes

1. **Calling a model directly from a controller** — always go through the service layer.
2. **String-interpolating SQL** — always use `$1, $2` parameterised placeholders.
3. **Throwing a plain `Error` instead of an `AppError` subclass** — the error handler will return a generic 500 instead of the correct status.
4. **Forgetting `asyncHandler`** — async route handlers not wrapped with it will silently swallow errors in some Express versions.
5. **Missing `validateRequest`** — the validator chain runs but does nothing without this middleware.
6. **Signing before XSD validation** — signing is expensive; always validate first.
7. **Retrying on HTTP-level SRI errors** — only retry on `fetch` throws (network failures), not on `!response.ok` responses.
8. **Not logging an ERROR audit event before re-throwing** — the document history will have a gap.
9. **Hard-deleting database rows** — update status or set `active = false` instead.
10. **Reading `process.env` directly** — always import from `src/config/index.js`.
11. **Omitting `documentType` from `POST /api/documents`** — it is a required field with no default. Callers must always supply it (e.g. `"01"` for a factura).
12. **Using `cert_path` / `cert_password_enc` from `req.issuer`** — these columns were removed in migration 028. Use `issuer.encrypted_private_key` and `issuer.certificate_pem` instead.
