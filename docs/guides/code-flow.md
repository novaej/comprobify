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
src/routes/index.js       → mounts /invoices
src/routes/invoices.routes.js  → defines the 5 endpoints
```

The top-level `index.js` is a simple aggregator. Adding a new resource (e.g. `/api/credit-notes`) means adding one line here without touching anything else.

Each route in `invoices.routes.js` follows the same pattern:

```
[validator chain]  →  validateRequest  →  asyncHandler(controller.fn)
```

**Why this pattern?**

- **Validator chain** (`express-validator`): declarative field rules applied before the controller runs. Keeps validation logic out of the controller.
- **`validateRequest` middleware**: reads the validation result from the chain and throws a `ValidationError` if any field failed. Keeps the controller clean — it never sees invalid input.
- **`asyncHandler` wrapper**: wraps the async controller function in a try/catch that calls `next(err)` on rejection. Without this, unhandled promise rejections in async route handlers crash silently in older Express versions (Express 4 does not catch them automatically).

---

## 6. Validators — `src/validators/invoice.validator.js`

The `createInvoice` array contains `express-validator` chain calls that validate every field of the request body: buyer identity, items (quantity, unit price, discount, taxes), payments, and optional additional info.

**Why express-validator and not manual checks in the controller?** The chain is declarative and co-located with the route. It produces structured error objects (field + message + value) that the error handler can return directly to the caller, making API errors machine-readable.

---

## 7. Controllers — `src/controllers/invoices.controller.js`

```js
const create = async (req, res) => {
  const document = await documentService.create(req.body);
  res.status(201).json({ ok: true, document });
};
```

Controllers are intentionally thin — one line to call the service, one line to respond. They know about HTTP (status codes, `req`, `res`) but nothing about business logic, XML, SRI, or the database.

**Why keep controllers thin?** It makes business logic testable without an HTTP layer. It also makes it trivial to change the transport (e.g. add a CLI command or a queue worker) without duplicating logic.

The only business decision a controller makes is: `404 NotFoundError` when `getByAccessKey` returns null — because "not found" is HTTP knowledge, not service knowledge.

---

## 8. Error hierarchy — `src/errors/`

```
AppError         — base: message + statusCode + isOperational flag
  ├── ValidationError  — 400, carries array of field errors
  ├── NotFoundError    — 404
  └── SriError         — 502, carries SRI SOAP message array
```

**Why a typed error hierarchy?** The error handler (`src/middleware/error-handler.js`) uses `instanceof AppError` to distinguish expected operational errors (validation failures, not-found, SRI rejections) from unexpected programming errors. Operational errors get their specific status code and message forwarded to the caller. Unexpected errors get a generic 500 with only an internal `console.error` — no stack trace leaks to the client.

The `isOperational` flag exists for future use: a process monitor could check it to decide whether to restart the process after a crash.

---

## 9. Error handler — `src/middleware/error-handler.js`

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

## 10. DocumentService — `src/services/document.service.js`

This is the orchestrator. It coordinates all other services and models to implement the four operations of the invoice lifecycle.

### `create(body)` — POST /api/invoices

Step-by-step:

```
1. issuerModel.findFirst()
   → Load the active issuer from the DB (RUC, cert path, environment, branch, etc.)
   → Throws AppError 500 if none configured.

2. sequentialService.getNext(issuerId, branchCode, issuePointCode, '01')
   → Opens a DB transaction with SELECT FOR UPDATE to get and increment the counter.
   → Returns the next sequential integer (e.g. 263).

3. accessKeyService.generate({...})
   → Assembles the 49-digit SRI access key from date + docType + RUC + environment
     + branch + issuePoint + sequential + numeric code + Module 11 check digit.

4. getBuilder('01', issuer).build(body, accessKey, sequential)
   → Constructs the unsigned XML document (infoTributaria + infoFactura + detalles + pagos).

5. xmlValidator.validate(unsignedXml)
   → Validates the XML against factura_V2.1.0.xsd before spending time signing.
   → Throws ValidationError if invalid — stops the request early with XSD error detail.

6. signingService.signXml(unsignedXml, certPath, certPasswordEnc)
   → Decrypts the cert password, loads the P12, applies XAdES-BES digital signature.

7. documentModel.create({...})
   → Inserts the document row (both unsigned and signed XML stored).

8. invoiceDetailModel.bulkCreate(documentId, items)
   → Inserts one row per line item into invoice_details for structured querying.

9. documentEventModel.create(documentId, 'CREATED', null, 'SIGNED', {...})
   → Writes the first audit log entry.

10. clientModel.findOrCreate(issuerId, buyer)  [non-blocking]
    → Upserts the buyer into the clients table.
    → Fire-and-forget: a failure here does not abort the invoice response.

11. Return formatDocument(document)
```

**Why validate before signing?** Signing is the most expensive operation (P12 load + RSA crypto). Failing fast on XSD errors avoids wasting that time on a document that SRI would reject anyway.

**Why store both unsigned and signed XML?** The unsigned XML is useful for debugging schema issues. The signed XML is what gets sent to SRI. Keeping both means you can re-inspect the document at any time without re-building.

**Why is `clientModel.findOrCreate` fire-and-forget?** Buyer persistence is a convenience feature — it builds up a client catalogue over time. It is not part of the invoice creation contract. If it fails (e.g. a DB hiccup), the invoice has already been created and signed, so aborting would leave a dangling sequential number with no invoice row. The warning is logged so it is not silent.

---

### `sendToSri(accessKey)` — POST /api/invoices/:accessKey/send

```
1. Load document, assert status === 'SIGNED'
2. sriService.sendReceipt(signedXml)     ← SOAP call with retry
3. sriResponseModel.create(...)          ← persist raw SRI response
4. documentModel.updateStatus('RECEIVED' | 'RETURNED')
5. documentEventModel.create('SENT', ...)
6. Return formatted document
```

If the SOAP call throws (network failure), an `ERROR` event is logged before re-throwing, so the audit trail always records the attempt.

**Why keep send and authorize as separate API calls?** SRI's offline reception API (`RecepcionComprobantesOffline`) is fire-and-accept: it validates structure and queues the document but does not authorize it immediately. Authorization requires a separate SOAP call to `AutorizacionComprobantesOffline`. The two-step split mirrors SRI's own protocol.

---

### `checkAuthorization(accessKey)` — GET /api/invoices/:accessKey/authorize

```
1. Load document, assert status === 'RECEIVED'
2. sriService.checkAuthorization(accessKey)   ← SOAP call with retry
3. sriResponseModel.create(...)
4. documentModel.updateStatus('AUTHORIZED' | 'NOT_AUTHORIZED', extraFields)
   extraFields: authorization_number, authorization_date, authorization_xml
5. documentEventModel.create('STATUS_CHANGED', oldStatus, newStatus, {...})
6. Return formatted document
```

The authorization XML returned by SRI is entity-encoded inside the SOAP `<comprobante>` element and stored as-is in `documents.authorization_xml`. Decode HTML entities before use (e.g. to render a PDF).

---

### `rebuild(accessKey, body)` — POST /api/invoices/:accessKey/rebuild

Used when SRI returns `RETURNED` (structural issue) or `NOT_AUTHORIZED` (content issue, e.g. wrong tax rate). The same access key and sequential are reused — SRI specs allow fixing and resubmitting with the same identity.

```
1. Load document, assert status === 'RETURNED' or 'NOT_AUTHORIZED'
2. Preserve issue_date, access_key, sequential from stored document
3. getBuilder('01', issuer).build({ ...body, issueDate }, access_key, sequential)
4. Validate payments total matches builder total
5. xmlValidator.validate(unsignedXml)       ← fail fast before signing
6. signingService.signXml(...)              ← fresh XAdES-BES signature
7. documentModel.updateStatus('SIGNED', {
     unsigned_xml, signed_xml, request_payload, subtotal, total,
     buyer_id, buyer_name, buyer_id_type
   })
8. documentEventModel.create('REBUILT', oldStatus, 'SIGNED', {})
9. Return formatted document
```

After `rebuild`, the document is back in `SIGNED` status and can be sent with `POST /:key/send` again.

---

## 11. SequentialService — `src/services/sequential.service.js`

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

## 12. AccessKeyService — `src/services/access-key.service.js`

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

## 13. Builders — `src/builders/`

```
builders/index.js         → registry: { '01': InvoiceBuilder }
builders/base.builder.js  → buildInfoTributaria(), toXml()
builders/invoice.builder.js → buildInfoFactura(), buildDetalles(), buildAdditionalInfo()
```

**Why a builder registry?** The `document.service` calls `getBuilder(documentTypeCode, issuer)` and gets back a builder without knowing which class it is. Adding a new document type (e.g. `'04'` credit note) requires only registering a new class — no changes to the service.

`BaseDocumentBuilder` holds the XML root attributes (`id="comprobante"`, `version="2.1.0"`) and the `infoTributaria` block, which is identical for all SRI document types. Namespace declarations (`xmlns:ds`, `xmlns:etsi`) are intentionally absent from the root element — they are injected by the signer directly onto `<ds:Signature>` to avoid inclusive C14N namespace pollution that would invalidate the digest.

`InvoiceBuilder.build()` is the main method — it calls all the sub-builders in the SRI-required XML element order and returns the serialized XML string via `toXml()` which uses `js2xmlparser` to convert the JS object tree to XML.

The builder stores `this.subtotal` and `this.total` as side effects of `buildInfoFactura()` so the service can read them for the DB row without re-calculating.

---

## 14. XmlValidatorService — `src/services/xml-validator.service.js`

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

## 15. SigningService — `src/services/signing.service.js`

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

## 16. CryptoService — `src/services/crypto.service.js`

```
Algorithm: AES-256-GCM
Stored format: hex(iv) + ':' + hex(authTag) + ':' + hex(ciphertext)
```

**Why AES-256-GCM?** GCM mode provides both encryption and authenticated integrity — any tampering with the stored ciphertext causes decryption to throw rather than silently returning garbage. The 256-bit key makes brute-force infeasible. A fresh random IV is generated for every `encrypt()` call so the same password never produces the same ciphertext twice.

**Why store the cert password encrypted instead of using the P12 passphrase directly?** The P12 file is a static file on disk. If someone gains read access to the disk they could copy the P12. Without the encrypted password in the DB they cannot use it. The encryption key lives in an environment variable (`ENCRYPTION_KEY`), so access requires both DB access and server environment access.

---

## 17. SriService — `src/services/sri.service.js`

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

## 18. Models — `src/models/`

All models use parameterized queries exclusively (`$1, $2, ...`) — never string interpolation. This is the primary SQL injection defense.

| Model | Table | Key operations |
|---|---|---|
| `issuer.model` | `issuers` | `findFirst`, `findByRuc`, `create` |
| `document.model` | `documents` | `create`, `findByAccessKey`, `updateStatus` |
| `sequential.model` | `sequential_numbers` | managed directly by `sequential.service` |
| `sri-response.model` | `sri_responses` | `create`, `findByDocumentId` |
| `client.model` | `clients` | `findOrCreate`, `findByIdentifier` |
| `product.model` | `products` | `findByCode`, `upsert` |
| `invoice-detail.model` | `invoice_details` | `bulkCreate` |
| `document-event.model` | `document_events` | `create`, `findByDocumentId` |

**Why raw `pg` instead of an ORM?** The queries are straightforward and the SRI lifecycle is domain-specific enough that the mapping overhead of an ORM adds more complexity than it removes. Raw `pg` queries are readable, debuggable, and do exactly what they say.

**`updateStatus` dynamic builder** (`document.model`):

```js
const sets = ['status = $2', 'updated_at = NOW()'];
for (const [col, val] of Object.entries(extraFields)) {
  sets.push(`${col} = $${idx}`);
}
```

The column names in `extraFields` come only from `document.service.js` internal code (not user input), so building the SET clause from them is safe. All values go through parameterized placeholders.

---

## 19. Document events — audit trail

Every state change in a document's lifecycle produces a row in `document_events`:

| Event | Triggered by |
|---|---|
| `CREATED` | After `documentModel.create` in `create()` |
| `SENT` | After `documentModel.updateStatus` in `sendToSri()` |
| `STATUS_CHANGED` | After `documentModel.updateStatus` in `checkAuthorization()` |
| `ERROR` | In the catch block of both SRI service calls |
| `REBUILT` | After `documentModel.updateStatus` in `rebuild()` |

The `from_status` / `to_status` columns make it possible to reconstruct the exact history of a document without reading multiple tables. The `detail` JSONB column carries context (access key, SRI status, authorization number, error message) without needing extra columns for every possible scenario.

---

## 20. Database schema overview

```
issuers (1)
  ├── documents (N)            ← one per invoice
  │     ├── invoice_details    ← one per line item
  │     ├── document_events    ← one per lifecycle transition
  │     └── sri_responses      ← one per SRI SOAP call
  ├── sequential_numbers (N)   ← one per branch/point/docType combination
  ├── clients (N)              ← buyers accumulated over time
  └── products (N)             ← product catalogue
```

All child tables reference `issuers(id)` directly or via `documents(id)`, enabling multi-tenant filtering with a simple `WHERE issuer_id = $1`.

---

## Request lifecycle summary

```
POST /api/invoices
  │
  ├── express.json()           parse JSON body
  ├── createInvoice validator  check every field
  ├── validateRequest          throw 400 if any field invalid
  └── asyncHandler
        └── controller.create
              └── documentService.create
                    ├── issuerModel.findFirst()        load issuer
                    ├── sequentialService.getNext()    BEGIN / SELECT FOR UPDATE / COMMIT
                    ├── accessKeyService.generate()    49-digit key + check digit
                    ├── InvoiceBuilder.build()         build unsigned XML
                    ├── xmlValidator.validate()        XSD check → 400 if invalid
                    ├── signingService.signXml()       decrypt password → XAdES-BES sign
                    ├── documentModel.create()         INSERT documents row
                    ├── invoiceDetailModel.bulkCreate() INSERT invoice_details rows
                    ├── documentEventModel.create()    INSERT CREATED event
                    └── clientModel.findOrCreate()     [fire-and-forget upsert]

→ 201 { ok: true, document: { accessKey, sequential, status, issueDate, total } }

POST /api/invoices/:key/send
  └── documentService.sendToSri
        ├── assert status === 'SIGNED'
        ├── sriService.sendReceipt()    fetchWithRetry → SOAP → parse estado
        ├── sriResponseModel.create()
        ├── documentModel.updateStatus('RECEIVED' | 'RETURNED')
        └── documentEventModel.create('SENT')

GET /api/invoices/:key/authorize
  └── documentService.checkAuthorization
        ├── assert status === 'RECEIVED'
        ├── sriService.checkAuthorization()   fetchWithRetry → SOAP → parse estado
        ├── sriResponseModel.create()
        ├── documentModel.updateStatus('AUTHORIZED' | 'NOT_AUTHORIZED')
        └── documentEventModel.create('STATUS_CHANGED')

POST /api/invoices/:key/rebuild
  └── documentService.rebuild
        ├── assert status === 'RETURNED' or 'NOT_AUTHORIZED'
        ├── InvoiceBuilder.build(body, stored access_key, stored sequential)
        ├── xmlValidator.validate()
        ├── signingService.signXml()
        ├── documentModel.updateStatus('SIGNED', { xml, payload, totals, buyer })
        └── documentEventModel.create('REBUILT')

Any unhandled throw →  errorHandler middleware
  ├── AppError subclass → specific status + message + (errors | sriMessages)
  └── Unknown error    → 500 "Internal server error" + console.error
```
