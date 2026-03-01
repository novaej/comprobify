# Code Flow — SRI Electronic Invoice API

A top-down walkthrough of how a request travels through every layer of the system, and why each piece was built the way it was.

---

## 1. Entry point — `app.js`

```
app.js
  → require('dotenv').config()
  → new Server()
  → server.listen()
```

`app.js` is intentionally minimal — three lines. Its only job is to load environment variables before any other `require` runs (so `process.env` is populated when `config/index.js` is evaluated), then hand off to the `Server` class.

**Why dotenv first?** Node evaluates `require` calls synchronously and caches modules. If `config/index.js` ran before `dotenv.config()`, all the `process.env.*` reads would return `undefined` and the cached defaults would be wrong for the entire process lifetime.

---

## 2. Server class — `src/server.js`

```js
class Server {
  constructor() {
    this.middlewares();   // 1. Parse + CORS
    this.routes();        // 2. Mount API routes
    this.errorHandling(); // 3. Mount error handler LAST
  }
}
```

The Express app lives inside a class rather than a bare module-level variable. This makes the server importable and instantiable in tests without side effects.

The constructor calls three setup methods in a fixed order because Express is an ordered middleware stack — the error handler must be registered after all routes, or it will never receive errors thrown inside them.

**Middlewares registered:**
- `cors()` — allows the API to be called from browser clients on other origins.
- `express.json()` — parses `Content-Type: application/json` bodies into `req.body`. Without this, `req.body` is always `undefined`.
- `express.static('public')` — serves any static files from `/public` (reserved for future use, e.g. RIDE PDFs).

---

## 3. Configuration — `src/config/index.js`

```js
const config = { port, environment, db: {...}, sri: {...} };
config.sri.baseUrl = environment === '2' ? prodUrl : testUrl;
config.sri.receptionUrl = `${baseUrl}/RecepcionComprobantesOffline?wsdl`;
config.sri.authorizationUrl = `${baseUrl}/AutorizacionComprobantesOffline?wsdl`;
module.exports = config;
```

All environment variables are read once here and exported as a plain object. No other file reads `process.env` directly.

**Why centralise config?** If a variable name changes in `.env` there is exactly one place to update. It also makes it easy to see every configurable value at a glance, and makes mocking config in tests trivial.

The SRI URLs are derived at startup based on `environment` (`'1'` = test, `'2'` = production). This way the rest of the code never needs to know which environment it is in — it just calls `config.sri.receptionUrl`.

---

## 4. Database pool — `src/config/database.js`

```js
const pool = new Pool({ ...config.db, max: 20, idleTimeoutMillis: 30000 });
const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();
module.exports = { pool, query, getClient };
```

A single `pg.Pool` is created once and shared across the entire process. The pool maintains up to 20 idle connections and reuses them across requests.

**Why a pool and not a single client?** A single client would be blocked while waiting for slow queries (e.g. SRI SOAP responses that arrive before a DB write). The pool lets concurrent requests each get their own connection.

`query` wraps `pool.query` — good for single statements where automatic connection management is fine. `getClient` returns a dedicated connection that the caller controls — required for explicit transactions (`BEGIN / COMMIT / ROLLBACK`).

---

## 5. Routes — `src/routes/`

```
src/routes/index.js          → mounts /documents
src/routes/documents.routes.js  → defines the endpoints
```

The top-level `index.js` is a simple aggregator. Adding a new resource (e.g. `/api/credit-notes`) means adding one line here without touching anything else.

Each route in `documents.routes.js` follows the same pattern:

```
authenticate  →  [optional middleware]  →  [validator chain]  →  validateRequest  →  asyncHandler(controller.fn)
```

`authenticate` is mounted first via `router.use(asyncHandler(authenticate))` at the top of the router, so every endpoint in the file requires a valid API key before any other middleware runs.

**Why this pattern?**

- **`authenticate`**: verifies the `Authorization: Bearer <token>` header and sets `req.issuer` before any business logic runs. Centralising authentication at the router level means no endpoint can accidentally be reached unauthenticated.
- **Optional middleware** (e.g. `extractIdempotencyKey`): thin, synchronous header extraction that runs before body validation. Keeps HTTP-level concerns out of the controller.
- **Validator chain** (`express-validator`): declarative field rules applied before the controller runs. Keeps validation logic out of the controller.
- **`validateRequest` middleware**: reads the validation result from the chain and throws a `ValidationError` if any field failed. Keeps the controller clean — it never sees invalid input.
- **`asyncHandler` wrapper**: wraps the async controller function in a try/catch that calls `next(err)` on rejection. Without this, unhandled promise rejections in async route handlers crash silently in older Express versions (Express 4 does not catch them automatically).

---

## 6. Validators — `src/validators/invoice.validator.js`

The `createInvoice` array contains `express-validator` chain calls that validate every field of the request body: buyer identity (including `buyer.email` as a required field), items (quantity, unit price, discount, taxes), payments, and optional `documentType`.

**Why express-validator and not manual checks in the controller?** The chain is declarative and co-located with the route. It produces structured error objects (field + message + value) that the error handler can return directly to the caller, making API errors machine-readable.

---

## 7. Authentication middleware — `src/middleware/authenticate.js`

```
Authorization: Bearer <token>
  │
  ├── missing header or wrong scheme → AppError 401
  ├── SHA-256(token) → keyHash
  ├── apiKeyModel.findByKeyHash(keyHash)  (JOINs api_keys with issuers)
  │     └── not found → AppError 401
  └── req.issuer = full issuer row (id, ruc, cert_path, cert_password_enc, ...)
```

Every protected route calls this middleware before anything else. It reads the `Authorization` header, computes `SHA-256(token)` as `keyHash`, and calls `apiKeyModel.findByKeyHash(keyHash)` which performs a JOIN between `api_keys` and `issuers`. If the key exists, the full issuer row is attached to `req.issuer` for downstream use.

**Why SHA-256 and not bcrypt?** API keys are 256-bit random strings — they are not guessable like user passwords. The bcrypt slowdown exists to prevent brute-force dictionary attacks, which are not a concern for a token with `2^256` possible values. SHA-256 comparison is fast and secure for long random tokens, while bcrypt would add 100–300 ms of unnecessary latency to every request.

**Why set `req.issuer` here?** It eliminates `issuerModel.findFirst()` from every service. Each service receives the issuer as a parameter and never queries the DB for it — the tenant is already known by the time the controller runs.

---

## 8. Controllers — `src/controllers/documents.controller.js`

```js
const create = async (req, res) => {
  const { document, created } = await documentCreation.create(req.body, req.idempotencyKey, req.issuer);
  res.status(created ? 201 : 200).json({ ok: true, document });
};
```

Controllers are intentionally thin — one call to the appropriate service, one response. They know about HTTP (status codes, `req`, `res`) but nothing about business logic, XML, SRI, or the database.

The controller imports from multiple focused services (`documentCreation`, `documentTransmission`, `documentRebuild`, `documentEmail`, `documentQuery`) rather than a single monolith. Each import handles one phase of the lifecycle.

**Why keep controllers thin?** It makes business logic testable without an HTTP layer. It also makes it trivial to change the transport (e.g. add a CLI command or a queue worker) without duplicating logic.

The only business decision a controller makes is: `404 NotFoundError` when `getByAccessKey` returns null — because "not found" is HTTP knowledge, not service knowledge.

---

## 9. Error hierarchy — `src/errors/`

```
AppError         — base: message + statusCode + isOperational flag
  ├── ValidationError  — 400, carries array of field errors
  ├── NotFoundError    — 404
  └── SriError         — 502, carries SRI SOAP message array
```

**Why a typed error hierarchy?** The error handler (`src/middleware/error-handler.js`) uses `instanceof AppError` to distinguish expected operational errors (validation failures, not-found, SRI rejections) from unexpected programming errors. Operational errors get their specific status code and message forwarded to the caller. Unexpected errors get a generic 500 with only an internal `console.error` — no stack trace leaks to the client.

The `isOperational` flag exists for future use: a process monitor could check it to decide whether to restart the process after a crash.

---

## 10. Error handler — `src/middleware/error-handler.js`

```js
const errorHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    const body = { ok: false, message: err.message };
    if (err.errors)      body.errors = err.errors;         // ValidationError
    if (err.sriMessages) body.sriMessages = err.sriMessages; // SriError
    return res.status(err.statusCode).json(body);
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, message: 'Internal server error' });
};
```

Registered last in the Express chain (four-argument signature). It is the single place where all errors in the system are translated into HTTP responses.

The `ok: false` / `ok: true` convention on all responses lets callers check a single field without parsing status codes.

---

## 11. Document Services — `src/services/`

The original monolith (`document.service.js`) was split into five focused services. Each service handles one phase of the document lifecycle. All services receive `issuer` as a parameter — they never look up the issuer themselves.

### `document-creation.service.js` — POST /api/documents

Step-by-step:

```
0. [If Idempotency-Key header present]
   documentModel.findByIdempotencyKey(key)
   → Found + hash matches  → return existing document, created=false (200, no transaction opened)
   → Found + hash differs  → throw ConflictError 409
   → Not found             → compute payloadHash = SHA-256(body), continue

1. Open explicit PostgreSQL transaction (BEGIN)

2. sequentialService.getNext(issuerId, branchCode, issuePointCode, documentType, client)
   → SELECT FOR UPDATE inside the transaction — guarantees no duplicate sequentials.

3. accessKeyService.generate({...})
   → 49-digit SRI key: date + docType + RUC + environment + branch + sequential + Module 11 check digit.

4. getBuilder(documentType, issuer).build(body, accessKey, sequential)
   → Constructs the unsigned XML tree (infoTributaria + infoFactura + detalles + pagos).

5. Validate payments total matches builder.total (early fail before XSD)

6. xmlValidator.validate(unsignedXml)   [async]
   → Writes tmp file, runs xmllint --schema, deletes tmp file.
   → Throws ValidationError with XSD errors if invalid.

7. signingService.signXml(unsignedXml, issuer.cert_path, issuer.cert_password_enc)
   → Decrypt cert password → XAdES-BES sign.

8. documentModel.create({ ..., idempotencyKey, payloadHash }, client)
   → INSERT into documents with all fields including buyer_email from body.buyer.email.
   → On 23505 unique violation (concurrent idempotency race): ROLLBACK, fetch winner, return created=false.

9. documentLineItemModel.bulkCreate(documentId, items, client)
   → Single multi-row INSERT into document_line_items.

10. documentEventModel.create(documentId, 'CREATED', null, 'SIGNED', {...}, client)
    → First audit log entry.

11. COMMIT
12. Return { document: formatDocument(document), created: true }
```

**Why `documentType` from the payload?** The creation service reads `body.documentType || '01'` — the document type comes from the caller, not a hardcoded constant. The builder registry maps the code to the correct builder class.

**Why buyer email is a required top-level field:** `body.buyer.email` is validated by the validator chain. It is no longer buried in `additionalInfo` — that extraction was a workaround removed in Phase 0.

**Why validate before signing?** Signing is the most expensive operation (P12 load + RSA crypto). Failing fast on XSD errors avoids wasting that time on a document that SRI would reject anyway.

**Why store both unsigned and signed XML?** The unsigned XML is useful for debugging schema issues. The signed XML is what gets sent to SRI. Keeping both means you can re-inspect the document at any time without re-building.

**Why SHA-256 for payload comparison?** Fetching the full JSONB `request_payload` from the DB and doing a deep JS equality check on every retry would be wasteful. A 64-character hex hash stored in a `TEXT` column is a constant-time comparison that adds zero query overhead.

**Why handle the 23505 race in the catch block?** Two concurrent requests with the same key can both pass the pre-transaction lookup (neither row exists yet) and race to the `INSERT`. The partial unique index guarantees only one wins. The loser catches the `23505` error code, rolls back, fetches the winner, and returns it — so the caller gets the correct `200` replay instead of a confusing `500`.

---

### `document-transmission.service.js` — POST /:key/send + GET /:key/authorize

**`sendToSri(accessKey, issuer)`**

```
1. findByAccessKey(accessKey, issuer.id)   — tenant-scoped
2. assertTransition(document.status, DocumentStatus.RECEIVED)
   → Throws AppError 400 if status is not SIGNED (the only valid predecessor of RECEIVED/RETURNED)
3. sriService.sendReceipt(signedXml, issuer.environment)   SOAP call with retry
   → On network throw: log ERROR event, re-throw
4. sriResponseModel.create(...)   persist raw SOAP response
5. newStatus = result.status === 'RECIBIDA' ? RECEIVED : RETURNED
6. documentModel.updateStatus(id, newStatus)
7. documentEventModel.create('SENT', ...)
8. Return formatDocument(updated)
```

**`checkAuthorization(accessKey, issuer)`**

```
1. findByAccessKey(accessKey, issuer.id)
2. assertTransition(document.status, DocumentStatus.AUTHORIZED)
   → Throws AppError 400 if status is not RECEIVED
3. sriService.checkAuthorization(accessKey, issuer.environment)   SOAP call
   → unescapeXml(comprobante) decodes &lt; &gt; &amp; etc. from the SOAP envelope
   → On network throw: log ERROR event, re-throw
4. sriResponseModel.create(...)
5. [result.pending] → return current document unchanged
6. newStatus = result.status === 'AUTORIZADO' ? AUTHORIZED : NOT_AUTHORIZED
7. documentModel.updateStatus(id, newStatus, extraFields)
   extraFields [AUTHORIZED]: authorization_number, authorization_date, authorization_xml
8. documentEventModel.create('STATUS_CHANGED', ...)
9. [AUTHORIZED] emailService.sendInvoiceAuthorized(updated)  [fire-and-forget]
   → On success: updateStatus({ email_status: 'SENT' }) + EMAIL_SENT event
   → On no email: updateStatus({ email_status: 'SKIPPED' })
   → On failure: updateStatus({ email_status: 'FAILED', email_error }) + EMAIL_FAILED event
10. Return formatDocument(updated)
```

**Why fire-and-forget for email?** The buyer notification is a convenience feature — it must not block or fail the authorization response. The document is already `AUTHORIZED` in the DB before the email is attempted. Failed sends are retried via `POST /email-retry` or `POST /:accessKey/email-retry`.

**Why keep send and authorize as separate API calls?** SRI's offline reception API (`RecepcionComprobantesOffline`) is fire-and-accept: it validates structure and queues the document but does not authorize it immediately. Authorization requires a separate SOAP call to `AutorizacionComprobantesOffline`. The two-step split mirrors SRI's own protocol.

---

### `document-rebuild.service.js` — POST /:key/rebuild

Used when SRI returns `RETURNED` (structural issue) or `NOT_AUTHORIZED` (content issue, e.g. wrong tax rate). The same access key and sequential are reused — SRI specs allow fixing and resubmitting with the same identity.

```
1. findByAccessKey(accessKey, issuer.id)
2. assertTransition(document.status, DocumentStatus.SIGNED)
   → Valid from RETURNED or NOT_AUTHORIZED only
3. Preserve issue_date, access_key, sequential from stored document
4. getBuilder('01', issuer).build({ ...body, issueDate }, access_key, sequential)
5. Validate payments total matches builder total
6. xmlValidator.validate(unsignedXml)
7. signingService.signXml(...)
8. documentModel.updateStatus('SIGNED', {
     unsigned_xml, signed_xml, request_payload, subtotal, total,
     buyer_id, buyer_name, buyer_id_type
   })
9. documentEventModel.create('REBUILT', oldStatus, 'SIGNED', {})
10. Return formatDocument(updated)
```

After `rebuild`, the document is back in `SIGNED` status and can be sent with `POST /:key/send` again.

---

### `document-email.service.js` — POST /email-retry + POST /:key/email-retry

Retry email sends that failed during the fire-and-forget `checkAuthorization` flow, or resend an already-sent email with `?force=true`.

`retryFailedEmails(issuer)`: queries all `AUTHORIZED` documents with `email_status IN ('PENDING', 'FAILED')` scoped by `issuer_id`, retries each one, returns `{ sent, failed }` counts.

`retrySingleEmail(accessKey, { force }, issuer)`: checks status is `AUTHORIZED`, checks no email → SKIPPED, checks `email_status === 'SENT' && !force` → early return (no re-send). Otherwise sends, updates `email_status`, logs event.

---

### `document-query.service.js` — GET /:key, GET /:key/xml, GET /:key/events

Three read-only operations, all tenant-scoped via `issuer.id`:

- `getByAccessKey(accessKey, issuer)` → `formatDocument(doc)` or null
- `getXml(accessKey, issuer)` → `authorization_xml || signed_xml` with `application/xml` content type
- `getEvents(accessKey, issuer)` → array of camelCase event objects from `document_events`

---

### `document.presenter.js` — `src/presenters/document.presenter.js`

`formatDocument(doc)` is the single place that maps a raw PostgreSQL row to the API response shape:

```js
{
  accessKey:           doc.access_key,
  documentType:        doc.document_type,
  sequential:          String(doc.sequential).padStart(9, '0'),
  status:              doc.status,
  issueDate:           moment(doc.issue_date).format('DD/MM/YYYY'),
  total:               doc.total,
  authorizationNumber: ...,   // only if present
  authorizationDate:   ...,   // only if present
  email: {
    status:  doc.email_status || 'PENDING',
    sentAt:  ...,             // only if present
    error:   ...,             // only if present
  },
}
```

Used by all five services — there is exactly one place to change the response shape.

---

### Document state machine — `src/constants/document-state-machine.js`

The full lifecycle state graph:

```
SIGNED → RECEIVED (send accepted by SRI)
SIGNED → RETURNED (send rejected by SRI)
RECEIVED → AUTHORIZED (checkAuthorization: approved)
RECEIVED → NOT_AUTHORIZED (checkAuthorization: rejected)
RETURNED → SIGNED (rebuild)
NOT_AUTHORIZED → SIGNED (rebuild)
AUTHORIZED → (terminal — no further transitions)
```

`assertTransition(from, to)` is called at the top of each service operation. It throws `AppError(400)` with `"Invalid state transition: X → Y"` if the transition is not in the allowed graph. This replaces the scattered `if (status !== X)` checks that previously existed across the monolith.

The same graph is enforced at the PostgreSQL level by `trg_document_state_transition` (migration 027) as defense in depth. `trg_document_immutability` (migration 026) additionally protects permanently immutable columns (`access_key`, `sequential`, `issuer_id`, etc.) and set-once authorization fields.

---

## 12. SequentialService — `src/services/sequential.service.js`

```js
await client.query('BEGIN');
SELECT current_value FROM sequential_numbers
  WHERE issuer_id=$1 AND branch_code=$2 AND issue_point_code=$3 AND document_type=$4
  FOR UPDATE;          ← row-level lock
UPDATE sequential_numbers SET current_value = next ...;
await client.query('COMMIT');
```

**Why `SELECT FOR UPDATE`?** Without the lock, two concurrent requests could both read the same `current_value`, both compute the same next value, and produce two invoices with duplicate sequential numbers. `FOR UPDATE` makes the second transaction wait until the first commits, guaranteeing uniqueness. PostgreSQL row-level locks are efficient — only the specific counter row is locked, not the whole table.

The service auto-creates the counter row on first use (`INSERT` if no row found) so there is no need to pre-seed the table.

---

## 13. AccessKeyService — `src/services/access-key.service.js`

Thin wrapper around `helpers/access-key-generator.js`. Translates between the service layer's camelCase arguments and the helper's expected signature.

**Why a wrapper instead of calling the helper directly?** The wrapper gives the service layer a clean interface and isolates tests — services mock `accessKeyService.generate`, not the helper internals.

The 49-digit access key is structured as:

```
DDMMYYYY  (8) — issue date
01        (2) — document type (01 = factura)
1712345678001 (13) — issuer RUC
1         (1) — environment (1=test, 2=prod)
001001    (6) — branch code + issue point
000000263 (9) — zero-padded sequential
00000263  (8) — numeric code
X         (1) — Module 11 check digit
```

---

## 14. Builders — `src/builders/`

```
builders/index.js         → registry: { '01': InvoiceBuilder }
builders/base.builder.js  → buildInfoTributaria(), toXml()
builders/invoice.builder.js → buildInfoFactura(), buildDetalles(), buildAdditionalInfo()
```

**Why a builder registry?** The creation and rebuild services call `getBuilder(documentTypeCode, issuer)` and get back a builder without knowing which class it is. Adding a new document type (e.g. `'04'` credit note) requires only registering a new class — no changes to the services.

`BaseDocumentBuilder` holds the XML root attributes (`id="comprobante"`, `version="2.1.0"`) and the `infoTributaria` block, which is identical for all SRI document types. Namespace declarations (`xmlns:ds`, `xmlns:etsi`) are intentionally absent from the root element — they are injected by the signer directly onto `<ds:Signature>` to avoid inclusive C14N namespace pollution that would invalidate the digest.

`InvoiceBuilder.build()` is the main method — it calls all the sub-builders in the SRI-required XML element order and returns the serialized XML string via `toXml()` which uses `js2xmlparser` to convert the JS object tree to XML.

The builder stores `this.subtotal` and `this.total` as side effects of `buildInfoFactura()` so the service can read them for the DB row without re-calculating.

---

## 15. XmlValidatorService — `src/services/xml-validator.service.js`

```js
function validate(xmlString) {
  const tmpFile = path.join(os.tmpdir(), `sri-validate-${process.pid}-${Date.now()}.xml`);
  try {
    fs.writeFileSync(tmpFile, xmlString, 'utf8');
    execFileSync('xmllint', ['--noout', '--schema', XSD_PATH, tmpFile], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return { valid: true };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
    const errors = stderr
      .split('\n')
      .filter((line) => line.includes('error') || line.includes('invalid'))
      .map((line) => ({ message: line.trim() }));
    return { valid: false, errors: errors.length ? errors : [{ message: stderr }] };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore cleanup errors */ }
  }
}
```

**Why `xmllint` instead of an npm package?** The Node.js XSD validation ecosystem is sparse and largely unmaintained (`libxmljs2` was end-of-life). `xmllint` is part of the system `libxml2` installation — the same C library those npm packages wrap — actively maintained by the OS, and available everywhere (pre-installed on macOS, available via `libxml2-utils` on Ubuntu/Debian). Zero npm footprint and no native rebuild issues across Node.js versions.

**Why a temp file?** `xmllint --schema` requires a file path for the document being validated; it does not accept stdin when a schema is involved. The file is always deleted in the `finally` block regardless of outcome.

**Why `--noout`?** Suppresses the serialised XML output — only the validation result and errors on stderr matter.

**Why validate before signing, not after?** If the XML is schema-invalid, SRI will reject it at reception. Catching it before signing saves the crypto cost and returns a clear 400 error to the caller with the specific XSD violation, instead of a cryptic SRI SOAP fault after the round-trip.

---

## 16. SigningService — `src/services/signing.service.js`

```js
function signXml(xmlString, certPath, certPasswordEnc) {
  const password = cryptoService.decrypt(certPasswordEnc);
  return sign(certPath, password, xmlString);
}
```

Thin wrapper around `helpers/signer.js` (XAdES-BES signing via `node-forge`). Its only responsibility is to decrypt the certificate password before passing it to the signing helper.

`helpers/signer.js` produces a valid XAdES-BES signature with:
- **RSA-SHA256** for the signature and all digests (not SHA-1)
- **2 References** in SignedInfo: `#comprobante` (enveloped, with enveloped-signature transform) then `#SignedProperties`
- **KeyInfo** contains only `X509Certificate` — no `RSAKeyValue`, no KeyInfo reference
- **Inclusive C14N** (C14N 1.0) applied by injecting `xmlns:ds` and `xmlns:etsi` directly on the element being digested
- **Issuer DN** formatted without spaces after commas (`CN=...,OU=...,O=...,C=EC`) to match Java-based SRI tooling

**Why wrap the helper?** Same reason as `accessKeyService` — isolates tests and keeps the service layer from knowing about the helper's internal API.

---

## 17. CryptoService — `src/services/crypto.service.js`

```
Algorithm: AES-256-GCM
Stored format: hex(iv) + ':' + hex(authTag) + ':' + hex(ciphertext)
```

**Why AES-256-GCM?** GCM mode provides both encryption and authenticated integrity — any tampering with the stored ciphertext causes decryption to throw rather than silently returning garbage. The 256-bit key makes brute-force infeasible. A fresh random IV is generated for every `encrypt()` call so the same password never produces the same ciphertext twice.

**Why store the cert password encrypted instead of using the P12 passphrase directly?** The P12 file is a static file on disk. If someone gains read access to the disk they could copy the P12. Without the encrypted password in the DB they cannot use it. The encryption key lives in an environment variable (`ENCRYPTION_KEY`), so access requires both DB access and server environment access.

---

## 18. SriService — `src/services/sri.service.js`

Handles the two SRI SOAP endpoints. Both calls go through `fetchWithRetry`:

```js
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = 1000 * 2 ** (attempt - 1); // 1s → 2s → 4s
      console.warn(`SRI fetch attempt ${attempt} failed, retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

**Why retry only on `fetch` throws and not on HTTP 4xx/5xx?** A thrown error means the TCP connection failed or timed out — a transient network problem worth retrying. An HTTP 4xx/5xx means SRI received and responded to the request — the document was already processed by SRI and retrying would likely produce the same response or cause a duplicate. The `if (!response.ok)` check below the fetch throws a `SriError` for HTTP-level failures without retrying.

**Why exponential backoff?** If SRI's server is temporarily overloaded, hammering it with immediate retries makes the overload worse. Doubling the wait time gives the server a chance to recover. After three attempts (7 seconds total), the error is surfaced to the caller as a `SriError`.

**Response parsing** uses regex-based tag extraction (`extractTagContent`, `extractAllTags`) rather than a full XML parser — the SRI SOAP envelopes are simple and predictable, and importing a full SOAP library for two endpoints would be over-engineering.

---

## 19. Models — `src/models/`

All models use parameterized queries exclusively (`$1, $2, ...`) — never string interpolation. This is the primary SQL injection defense.

| Model | Table | Key operations |
|---|---|---|
| `issuer.model` | `issuers` | `findById`, `findByRuc`, `create` |
| `api-key.model` | `api_keys` | `findByKeyHash` (JOINs issuers), `create`, `revoke` |
| `document.model` | `documents` | `create`, `findByAccessKey(accessKey, issuerId)`, `findById`, `updateStatus` (column-whitelisted), `findPendingEmails(issuerId)`, `findByIdempotencyKey` |
| (no model) | `sequential_numbers` | managed directly by `sequential.service` |
| `sri-response.model` | `sri_responses` | `create`, `findByDocumentId` |
| `document-line-item.model` | `document_line_items` | `bulkCreate` (single multi-row INSERT) |
| `document-event.model` | `document_events` | `create`, `findByDocumentId` |

`issuer.model` no longer exposes `findFirst()` — issuers are always loaded via `apiKeyModel.findByKeyHash()` during authentication and passed as `req.issuer` to services. There is no "load the active issuer" step anywhere in the creation or transmission flow.

**Why raw `pg` instead of an ORM?** The queries are straightforward and the SRI lifecycle is domain-specific enough that the mapping overhead of an ORM adds more complexity than it removes. Raw `pg` queries are readable, debuggable, and do exactly what they say.

**`updateStatus` dynamic builder** (`document.model`):

```js
const sets = ['status = $2', 'updated_at = NOW()'];
for (const [col, val] of Object.entries(extraFields)) {
  sets.push(`${col} = $${idx}`);
}
```

The column names in `extraFields` are validated against a `MUTABLE_EXTRA_COLUMNS` Set (a whitelist of allowed column names) before the SET clause is built. If a caller passes an unknown column name, `updateStatus` throws rather than silently executing a malformed query. All values go through parameterized placeholders regardless.

---

## 20. Document events — audit trail

Every state change in a document's lifecycle produces a row in `document_events`:

| Event | Triggered by |
|---|---|
| `CREATED` | After `documentModel.create` in `create()` |
| `SENT` | After `documentModel.updateStatus` in `sendToSri()` |
| `STATUS_CHANGED` | After `documentModel.updateStatus` in `checkAuthorization()` |
| `ERROR` | In the catch block of both SRI service calls |
| `REBUILT` | After `documentModel.updateStatus` in `rebuild()` |
| `EMAIL_SENT` | After successful email delivery (fire-and-forget in `checkAuthorization`, or explicit retry) |
| `EMAIL_FAILED` | After failed email delivery — `detail` contains `{ error }` or `{ to, error }` |

The `from_status` / `to_status` columns make it possible to reconstruct the exact history of a document without reading multiple tables. The `detail` JSONB column carries context (access key, SRI status, authorization number, error message) without needing extra columns for every possible scenario.

---

## 21. Database schema overview

```
issuers (1)
  ├── api_keys (N)             ← one per API credential
  ├── documents (N)            ← one per invoice
  │     ├── document_line_items ← one per line item
  │     ├── document_events    ← one per lifecycle transition
  │     └── sri_responses      ← one per SRI SOAP call
  └── sequential_numbers (N)   ← one per branch/point/docType combination
```

All child tables reference `issuers(id)` directly or via `documents(id)`, enabling multi-tenant filtering with a simple `WHERE issuer_id = $1`.

---

## 22. RideService — `src/services/ride.service.js`

Generates the RIDE (Representación Impresa del Documento Electrónico) PDF for an `AUTHORIZED` document on demand. No PDF is persisted — it is generated fresh on every request.

```
1. documentModel.findByAccessKey(accessKey, issuer.id)   — tenant-scoped
   → Throws NotFoundError 404 if not found.
   → Throws AppError 400 if status !== 'AUTHORIZED'.

2. issuerModel.findById(issuer.id)
   → Loads issuer fields (RUC, business_name, trade_name, addresses,
     logo_path, special_taxpayer, required_accounting, emission_type).

3. Resolve catalog labels (one-time DB query per table, then Map cache):
   → catalogModel.getIdTypeLabel(buyer_id_type)        → e.g. 'Cédula'
   → catalogModel.getPaymentMethodLabel(method)         → per payment
   → catalogModel.getTaxRateDescription(code, rateCode) → per distinct tax key

4. Assemble rideData plain object from document, issuer, and document.request_payload

5. rideBuilder.build(rideData)   → Promise<Buffer>
   → PDFKit A4 renderer (see helpers/ride-builder.js)
   → Returns raw PDF bytes as a Node Buffer

6. Return buffer to controller → sent as application/pdf
```

**Why generate on-the-fly?** RIDE PDFs are only needed for `AUTHORIZED` documents. Generating on demand avoids storage overhead and ensures the PDF always reflects the current DB state (authorization number, date). PDFs are typically small (< 100 KB) and generation is fast.

**Tax computation** — amounts are re-derived from payload fields (`qty × unitPrice − discount`) rather than stored pre-computed values. Rate codes (`'0'`=0%, `'6'`=No objeto, `'7'`=Exento) are used as the authoritative classifier — never rate values, which are the same (0) for all three categories.

**`helpers/ride-builder.js`** — PDFKit A4 layout engine. Uses `doc.heightOfString()` to pre-measure all variable-height content (additional info rows, payment labels) before drawing enclosing boxes, preventing overflow. All coordinates are explicit (x, y) — the internal PDFKit cursor is never relied upon for multi-column layout.

---

## Request lifecycle summary

```
POST /api/documents
  │
  ├── express.json()              parse JSON body
  ├── authenticate                SHA-256(Bearer token) → api_keys → req.issuer (401 if invalid)
  ├── extractIdempotencyKey       read Idempotency-Key header → req.idempotencyKey
  ├── createInvoice validator     check every field
  ├── validateRequest             throw 400 if any field invalid
  └── asyncHandler
        └── controller.create
              └── documentCreation.create(body, idempotencyKey, req.issuer)
                    ├── [key present] documentModel.findByIdempotencyKey()
                    │     ├── found + hash match  → return existing doc (200, no transaction)
                    │     └── found + hash diff   → ConflictError 409
                    ├── BEGIN
                    ├── sequentialService.getNext()    SELECT FOR UPDATE
                    ├── accessKeyService.generate()    49-digit key + check digit
                    ├── getBuilder(documentType, issuer).build()  unsigned XML
                    ├── xmlValidator.validate()        XSD check → 400 if invalid
                    ├── signingService.signXml()       decrypt password → XAdES-BES sign
                    ├── documentModel.create()         INSERT with idempotency_key + payload_hash
                    │     └── 23505 race → ROLLBACK, fetch winner, return 200 replay
                    ├── documentLineItemModel.bulkCreate()  single multi-row INSERT
                    ├── documentEventModel.create()    INSERT CREATED event
                    └── COMMIT

→ 201 { ok: true, document: { accessKey, documentType, sequential, status, ... } }  (new)
→ 200 { ok: true, document: {...} }   (idempotent replay)

POST /api/documents/:key/send
  └── authenticate → req.issuer
        └── documentTransmission.sendToSri(accessKey, issuer)
              ├── assertTransition(status, RECEIVED)   [throws 400 if not SIGNED]
              ├── sriService.sendReceipt()    fetchWithRetry → SOAP → parse estado
              ├── sriResponseModel.create()
              ├── documentModel.updateStatus(RECEIVED | RETURNED)
              └── documentEventModel.create(SENT)

GET /api/documents/:key/authorize
  └── authenticate → req.issuer
        └── documentTransmission.checkAuthorization(accessKey, issuer)
              ├── assertTransition(status, AUTHORIZED)  [throws 400 if not RECEIVED]
              ├── sriService.checkAuthorization()   fetchWithRetry → SOAP → unescapeXml → parse estado
              ├── sriResponseModel.create()
              ├── documentModel.updateStatus(AUTHORIZED | NOT_AUTHORIZED)
              ├── documentEventModel.create(STATUS_CHANGED)
              └── [AUTHORIZED] emailService.sendInvoiceAuthorized()  [fire-and-forget]
                    ├── rideService.generate()     → PDF Buffer
                    ├── Buffer.from(authorization_xml)  → XML Buffer
                    ├── mailgunProvider.send(to, attachments)
                    └── documentModel.updateStatus({ email_status }) + EMAIL_SENT/EMAIL_FAILED event

POST /api/documents/:key/rebuild
  └── authenticate → req.issuer
        └── documentRebuild.rebuild(accessKey, body, issuer)
              ├── assertTransition(status, SIGNED)  [throws 400 if not RETURNED/NOT_AUTHORIZED]
              ├── getBuilder('01', issuer).build(body, stored access_key, stored sequential)
              ├── xmlValidator.validate()
              ├── signingService.signXml()
              ├── documentModel.updateStatus(SIGNED, { xml, payload, totals, buyer })
              └── documentEventModel.create(REBUILT)

GET /api/documents/:key/events
  └── authenticate → req.issuer
        └── documentQuery.getEvents(accessKey, issuer)
              └── documentEventModel.findByDocumentId(document.id)
              → [{ id, eventType, fromStatus, toStatus, detail, createdAt }, ...]

GET /api/documents/:key/ride
  └── authenticate → req.issuer
        └── rideService.generate
              ├── assert status === 'AUTHORIZED'
              ├── issuerModel.findById()
              ├── catalogModel label lookups (getIdTypeLabel, getPaymentMethodLabel, getTaxRateDescription)
              └── rideBuilder.build(rideData)  → Buffer

→ 200 application/pdf (Content-Disposition: attachment; filename="RIDE-{accessKey}.pdf")

GET /api/documents/:key/xml
  └── authenticate → req.issuer
        └── documentQuery.getXml(accessKey, issuer)
              └── authorization_xml if AUTHORIZED, else signed_xml

→ 200 application/xml (Content-Disposition: attachment; filename="{accessKey}.xml")

POST /api/documents/email-retry         ← batch
  └── authenticate → req.issuer
        └── documentEmail.retryFailedEmails(issuer)
              └── documentModel.findPendingEmails(issuerId)  (status=AUTHORIZED, email_status IN (PENDING,FAILED), max 100)
                    └── emailService.sendInvoiceAuthorized() per doc → updateStatus + event

→ 200 { ok: true, result: { sent: N, failed: N } }

POST /api/documents/:key/email-retry    ← single
  └── authenticate → req.issuer
        └── documentEmail.retrySingleEmail(accessKey, { force }, issuer)
              ├── assert status === 'AUTHORIZED'
              └── emailService.sendInvoiceAuthorized() → updateStatus + EMAIL_SENT/EMAIL_FAILED event

→ 200 { ok: true, result: { sent: true } }

Any unhandled throw →  errorHandler middleware
  ├── AppError subclass → specific status + message + (errors | sriMessages)
  └── Unknown error    → 500 "Internal server error" + console.error
```
