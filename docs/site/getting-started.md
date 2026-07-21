# Primeros Pasos

## URL base

```
https://api.comprobify.com/v1
```

Todos los ejemplos de este sitio usan rutas relativas a esa base (p. ej. `POST /v1/register` significa `POST https://api.comprobify.com/v1/register`).

## Colección de Postman

Importa la colección completa para probar cada endpoint directamente desde Postman — todas las solicitudes vienen preconfiguradas con variables para tu URL base, tu llave API y tu clave de acceso.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/15935880-2sBXiqE8vL)

> **Configuración inicial:** después de importar, abre la colección, ve a **Variables**, y configura `base_url` como `https://api.comprobify.com` y `api_key` con tu llave API. Después de crear una factura, copia el `accessKey` devuelto en la variable `access_key`.

También puedes descargar el JSON de la colección directamente: [`comprobify.postman_collection.json`](https://raw.githubusercontent.com/novaej/comprobify/main/postman/comprobify.postman_collection.json)

---

## 1. Registro

Crea tu cuenta, emisor y llave API de sandbox en una sola llamada. Cada RUC solo puede registrarse una vez.

```http
POST /v1/register
Content-Type: multipart/form-data
```

| Campo | Descripción |
|---|---|
| `email` | Tu dirección de correo — usada para verificación y facturación |
| `ruc` | Tu RUC ecuatoriano de 13 dígitos |
| `businessName` | Razón social tal como aparece en tu RUC |
| `branchCode` | Código de sucursal SRI de 3 dígitos (p. ej. `001` para la sucursal principal) |
| `issuePointCode` | Código de punto de emisión SRI de 3 dígitos (p. ej. `001`) |
| `emissionType` | Tipo de emisión SRI: siempre `1` (normal) |
| `requiredAccounting` | `true` si tu empresa está obligada a llevar contabilidad, `false` en caso contrario |
| `cert` | Tu archivo de certificado digital `.p12` emitido por la CA del SRI (Banco Central o Security Data) |
| `certPassword` | Contraseña del archivo `.p12` |

Respuesta:

```json
{
  "ok": true,
  "tenant": {
    "id": "00000000-0000-0000-0000-000000000001",
    "email": "your@email.com",
    "subscriptionTier": "FREE",
    "status": "PENDING_VERIFICATION",
    "documentQuota": 5
  },
  "issuer": { "id": "00000000-0000-0000-0000-000000000001", "ruc": "...", "sandbox": true },
  "apiKey": "<your-sandbox-api-key>"
}
```

**Guarda el `apiKey` — se muestra solo una vez.**

La cuenta comienza en el tier **FREE** (5 comprobantes, 1 sucursal, 1 punto de emisión, solo facturas). Todos los comprobantes se envían al ambiente de pruebas del SRI hasta que te promuevas a producción. Las pruebas en sandbox no consumen la cuota — solo los comprobantes de producción lo hacen.

**Errores de registro:**

| Estado HTTP | Código | Razón |
|---|---|---|
| `409` | `CONFLICT` | El correo ya está registrado |
| `409` | `CONFLICT` | El RUC ya está registrado |
| `400` | `BAD_REQUEST` | El certificado está expirado o es inválido |
| `429` | `TOO_MANY_REQUESTS` | Más de 5 intentos de registro por hora desde esta IP |

---

## 2. Verifica tu correo

Se envía un correo de verificación a la dirección con la que te registraste. Haz clic en el enlace, o llama al endpoint directamente con el token del correo:

```http
GET /v1/verify-email?token=<token>
```

Se requiere verificación de correo antes de poder promoverte a producción. Puedes emitir facturas de sandbox de inmediato sin verificar.

> Si estás integrando de forma programática y el correo no está disponible, contacta a soporte para verificar tu cuenta manualmente.

---

## 3. Autentica las solicitudes

Incluye tu llave API como token Bearer en cada solicitud de comprobante:

```http
Authorization: Bearer <your-api-key>
```

La llave se hashea con SHA-256 en cada solicitud — el texto plano nunca se persiste después de la creación. Si una llave se ve comprometida, contacta a soporte para revocarla y emitir una nueva.

---

## Entendiendo las llaves API y las sucursales

Este es el concepto más importante que debes entender antes de integrar.

**Una sola llave API cubre toda tu cuenta (todas las sucursales).** Las llaves API están **vinculadas al tenant**, no al emisor. Una llave puede operar sobre cualquiera de tus sucursales; declaras la sucursal destino a través del encabezado `X-Issuer-Id` en cada solicitud.

Tu cuenta (tenant) puede tener múltiples emisores — cada uno es un par único de `branchCode` y `issuePointCode` (p. ej., `001/001`, `001/002`, `002/001`). Cuando llamas a `POST /v1/documents`, la API usa la llave para identificar tu tenant, luego usa `X-Issuer-Id` para determinar:
- Qué sucursal y punto de emisión incrustar en el comprobante
- Con qué certificado digital firmar
- De qué secuencia de números secuenciales tomar el siguiente

### Listando tus emisores

```http
GET /v1/issuers
Authorization: Bearer <your-api-key>
```

Devuelve cada emisor (sucursal / punto de emisión) bajo tu tenant con su `id`. Usa ese `id` como el valor del encabezado `X-Issuer-Id` en las solicitudes de comprobantes.

### Agregando una nueva sucursal o punto de emisión

Una vez que tu correo esté verificado, llama a `POST /v1/issuers` con tu llave API:

```http
POST /v1/issuers
Authorization: Bearer <your-api-key>
Content-Type: multipart/form-data

branchCode=002
issuePointCode=001
```

El nuevo emisor hereda tu RUC, razón social y certificado digital del primer emisor existente de tu tenant (o puedes pasar `sourceIssuerId` para elegir uno específico):

```json
{
  "ok": true,
  "issuer": { "id": "00000000-0000-0000-0000-000000000002", "branchCode": "002", "issuePointCode": "001", "sandbox": true }
}
```

No se genera ninguna llave API nueva — la llave que ya tienes cubre cada sucursal bajo tu tenant.

### Múltiples llaves con nombre por tenant

Dado que una sola llave vinculada al tenant cubre todas tus sucursales, puedes generar llaves adicionales vía `POST /v1/keys` para rastrear qué integración está haciendo cada llamada (frontend, ERP, app móvil, etc.):

```http
POST /v1/keys
Authorization: Bearer <your-api-key>
Content-Type: application/json

{ "label": "ERP integration", "environment": "sandbox" }
```

Usa `GET /v1/keys` para listarlas y `DELETE /v1/keys/:id` para revocar una. `environment` por defecto es `sandbox`; generar una llave `production` requiere que el tenant ya se haya promovido. Todas las llaves bajo el mismo tenant pueden operar sobre el mismo conjunto de sucursales — la diferencia está en la observabilidad (qué integración hizo la llamada) y en la revocación granular (revocar una integración comprometida sin afectar a las demás).

### Ciclo de vida de las llaves

| Etapa | Ambiente de la llave | Qué hacer |
|---|---|---|
| Después del registro | Sandbox | Úsala para pruebas contra el ambiente de pruebas del SRI. |
| Después de `POST /v1/tenants/promote` | Producción | Todas las llaves de sandbox se revocan y se devuelven sus equivalentes de producción en la respuesta. |
| Agregando integraciones | Mismo tenant | Genera llaves con nombre vía `POST /v1/keys` para observabilidad por integración. |
| Llave perdida | — | Genera un reemplazo vía `POST /v1/keys`, revoca la anterior vía `DELETE /v1/keys/:id`. |

### ¿Por qué llaves vinculadas al tenant?

Una sola llave cubre toda tu cuenta, así que un frontend o ERP que opera sobre múltiples sucursales no tiene que manejar credenciales separadas. La trazabilidad por integración proviene de llaves con nombre (`frontend-prod`, `erp`, `mobile`) en lugar de llaves por sucursal. Revocar una llave filtrada solo afecta a la integración que la usaba; las demás llaves siguen funcionando.

---

## 4. Registra un endpoint de webhook (recomendado)

Registra una URL HTTPS en tu servidor para recibir notificaciones de eventos casi en tiempo real — autorizaciones de comprobantes, alertas de certificados, y cualquier futuro tipo de evento que la API produzca.

```http
POST /v1/webhooks
Authorization: Bearer <your-api-key>
Content-Type: application/json

{
  "url": "https://app.example.com/v1/comprobify/events",
  "eventTypes": ["DOCUMENT_AUTHORIZED", "CERT_EXPIRING", "CERT_EXPIRED"]
}
```

Respuesta:

```json
{
  "ok": true,
  "endpoint": {
    "id": "00000000-0000-0000-0000-000000000001",
    "url": "https://app.example.com/v1/comprobify/events",
    "eventTypes": ["DOCUMENT_AUTHORIZED", "CERT_EXPIRING", "CERT_EXPIRED"],
    "active": true
  },
  "secret": "a3f5c8d1e2b4..."
}
```

**Guarda el `secret` de inmediato — se muestra solo una vez.** Úsalo para verificar el encabezado `X-Comprobify-Signature` en cada solicitud entrante.

Omite `eventTypes` (o pasa `[]`) para suscribirte a todos los tipos de evento. Puedes registrar hasta el límite de tu plan (FREE: 1, STARTER: 2, GROWTH: 5, BUSINESS: 10) y gestionarlos vía `GET / PATCH / DELETE /v1/webhooks`.

> **Si no puedes exponer una URL HTTPS pública** (desarrollo local, detrás de un firewall), sondea `GET /v1/notifications?sinceId=<lastId>` en su lugar. Guarda el `id` más alto visto en cada sondeo y pásalo en la siguiente solicitud para ponerte al día de forma eficiente — consulta [Notificaciones](endpoints/notifications.md).

---

## 5. Crea una factura

```http
POST /v1/documents
Authorization: Bearer <your-api-key>
X-Issuer-Id: <issuer-id>
Content-Type: application/json
Idempotency-Key: <unique-key>   (opcional pero recomendado)

{
  "documentType": "01",
  "buyer": {
    "idType": "05",
    "id": "1234567890",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "items": [...],
  "payments": [...]
}
```

Cada endpoint de comprobante (POST, GET, DELETE) requiere el encabezado `X-Issuer-Id` que nombra la sucursal destino. Si lo omites → `400 ISSUER_ID_REQUIRED`. Si pasas un id que pertenece a otro tenant → `403 ISSUER_FORBIDDEN`.

Devuelve el comprobante firmado con estado `SIGNED`. Consulta [Create Invoice](endpoints/create-invoice.md) para conocer el esquema completo.

---

## 6. Envía al SRI

```http
POST /v1/documents/:accessKey/send
```

Envía el XML firmado al SRI. El comprobante pasa a `RECEIVED` o `RETURNED`.

- **`RECEIVED`** — El SRI aceptó el comprobante para su procesamiento. Continúa con el paso 7.
- **`RETURNED`** — El SRI rechazó el comprobante (datos inválidos, error de esquema, etc.). Corrige el problema y [reconstruye](endpoints/rebuild-invoice.md) antes de reenviar.

---

## 7. Consulta la autorización

```http
GET /v1/documents/:accessKey/authorize
```

Consulta al SRI el resultado de la autorización.

- **`AUTHORIZED`** — La factura es legalmente válida. Se envía automáticamente un correo con el PDF del RIDE y el XML al comprador.
- **`NOT_AUTHORIZED`** — El SRI procesó el comprobante pero no lo autorizó. [Reconstruye](endpoints/rebuild-invoice.md) con los datos corregidos y reenvía.

---

## Pasando a producción

Una vez que hayas verificado tu correo y probado tu integración en sandbox:

```http
POST /v1/tenants/promote
Authorization: Bearer <your-api-key>
Content-Type: application/json

{}
```

Un cuerpo vacío es válido. Opcionalmente puedes proporcionar `initialSequentials` para establecer los números secuenciales iniciales por emisor y tipo de comprobante.

Esto es de **una sola dirección** — no hay vuelta atrás al sandbox. Al tener éxito:
- **Todas las llaves API de sandbox activas se revocan** y se crea una llave de producción por cada una de ellas, conservando la misma etiqueta
- Todos los nuevos tokens de producción se devuelven en la respuesta — **guárdalos de inmediato, se muestran solo una vez**
- Todas las sucursales se promueven a la vez — no existe la promoción por sucursal
- Todos los comprobantes posteriores de cualquier sucursal se enviarán al endpoint de producción del SRI con `ambiente = 2`

```json
{
  "ok": true,
  "apiKeys": [
    { "label": "Initial sandbox key", "apiKey": "<production-token>" },
    { "label": "ERP integration",     "apiKey": "<production-token>" }
  ]
}
```

Distribuye cada token a la integración que anteriormente usaba la llave de sandbox con la misma etiqueta.

> Si el estado de tu cuenta es `PENDING_VERIFICATION` (correo aún no verificado), esta llamada devuelve `403`. Verifica tu correo primero.

---

## Tiers de suscripción

| Plan | Precio/mes | Precio/año | Cuota de comprobantes **(por mes)** | Tipos de comprobante | Sucursales máx. | Puntos de emisión máx. por sucursal | Endpoints de webhook máx. | Límite de escritura |
|---|---|---|---|---|---|---|---|---|
| Free | $0 | $0 | 5 | Factura (`01`) | 1 | 1 | 1 | 10 req/min |
| Starter | $19 | $190 | 200 | Factura (`01`) | 3 | 2 | 2 | 60 req/min |
| Growth | $79 | $790 | 1,000 | Factura, Nota de Crédito (`01`, `04`) | 10 | 5 | 5 | 120 req/min |
| Business | $199 | $1,990 | 4,000 | Factura, Nota de Crédito (`01`, `04`) | Ilimitado | Ilimitado | 10 | 300 req/min |

El precio anual equivale a 2 meses gratis frente a pagar mensualmente — **elegir el pago anual solo cambia con qué frecuencia pagas, no con qué frecuencia se reinicia tu cuota de comprobantes.** La columna de cuota es una cifra mensual en cada tier, ya sea que te facturen mensual o anualmente. Consulta [Get Tiers](endpoints/get-tiers.md) para ver este mismo catálogo como una respuesta pública de la API.

La cuota de comprobantes se comparte entre todas las sucursales y tipos de comprobante, y cuenta **solo los comprobantes de producción** — los comprobantes de sandbox/prueba nunca la consumen. Cuando la alcanzas, `POST /v1/documents` devuelve `402 QUOTA_EXCEEDED`. Consulta "Mejorando a un plan pagado" abajo.

> **Limitación actual:** la cuota todavía no se reinicia automáticamente al comienzo de cada mes — hoy no existe un job de reinicio mensual, así que en la práctica actualmente se comporta como un tope acumulativo de una sola vez en lugar de una asignación mensual recurrente. Esto es independiente de las [renovaciones de suscripción](#mejorando-a-un-plan-pagado) (que mantienen tu *facturación* al día) y se rastrea por separado para una futura versión.

### Mejorando a un plan pagado

1. **Solicita un tier.** Dos formas de hacerlo:
   - [`POST /v1/subscriptions`](endpoints/create-subscription.md) con `{ "tier": "STARTER" }` (o `GROWTH`/`BUSINESS`, opcionalmente `"billingInterval": "YEARLY"`) — funciona incluso mientras sigues en sandbox, así que puedes empezar a pagar antes de promoverte.
   - O llama a [`POST /v1/tenants/promote`](endpoints/promote-tenant.md) con el mismo cuerpo, para solicitar un tier en la misma llamada que la promoción. La promoción a producción ocurre de inmediato de cualquier forma — nunca te quedas bloqueado esperando el pago.

   De cualquier forma, la respuesta incluye `payment` y `bankTransfer` (nombre del banco, número de cuenta, titular de la cuenta) para el monto de la transferencia SPI. Si ya iniciaste una suscripción vía `POST /v1/subscriptions` y ya está `ACTIVE` para cuando te promuevas, los campos `tier`/`billingInterval` de `promote` se ignoran — simplemente muestra esa suscripción existente en su lugar.
2. **Envía la transferencia.** Si tu banco te permite agregar una descripción o referencia a la transferencia, coloca ahí este `payment.id` (p. ej. "Comprobify payment 18") — no generamos ningún otro número de orden, así que esta es la forma más rápida para que tu proveedor relacione la transferencia con tu pago. Es opcional (no todos los bancos lo permiten), pero vale la pena hacerlo cuando esté disponible.
3. **Sube el comprobante de la transferencia**: [`PATCH /v1/payments/:id/proof`](endpoints/submit-payment-proof.md) (multipart — una captura de pantalla o PDF del recibo, más un campo `referenceNumber` requerido con la referencia de transferencia propia de tu banco), usando el `payment.id` del paso 1.
4. **Espera la revisión.** Tu proveedor verifica el comprobante contra el banco y lo aprueba o lo rechaza — recibirás un correo en cualquier caso (y una [notificación](endpoints/notifications.md), distribuida a tus webhooks si tienes alguno registrado), sin necesidad de sondear. Una vez verificado, ellos se autofacturan y autorizan el comprobante correspondiente a ese período; `subscriptionTier`/`documentQuota` (vía [`GET /v1/tenants/me`](endpoints/tenant-me.md)) se actualizan automáticamente en cuanto eso ocurre. [`GET /v1/subscriptions/me`](endpoints/get-my-subscriptions.md) muestra el historial completo intermedio en cualquier momento.
5. **Si es rechazado**, el correo explica por qué en lenguaje sencillo, y `GET /v1/subscriptions/me` muestra la misma razón como un `rejection_reason_code` estable (p. ej. `TRANSFER_NOT_FOUND`) para que tu propia interfaz lo asocie con un mensaje. Corrige lo que se señaló y repite los pasos 2-3 para el mismo `payment.id` — un rechazo no es un callejón sin salida.
6. Hasta que se verifique y autorice, estás en los límites de FREE en producción — nada se bloquea, simplemente todavía no tienes la cuota más alta.

**Renovando.** Tu suscripción no es un pago único — `current_period_end` es una fecha de facturación recurrente real. Unos 7 días antes de esa fecha, recibirás un correo (y una notificación) de que hay un nuevo pago `RENEWAL` abierto, con las mismas instrucciones de transferencia bancaria que antes; repite los pasos 2-3 de arriba usando el id de ese pago. Si no renuevas, tu plan sigue funcionando tal cual hasta unos 7 días *después* de `current_period_end`, momento en el que se te mueve automáticamente de vuelta a FREE (con un correo explicando por qué) — siempre puedes iniciar una nueva suscripción después mediante el paso 1.

Intentar crear una sucursal más allá del límite del tier devuelve `402 BRANCH_LIMIT_REACHED` / `ISSUE_POINT_LIMIT_REACHED`. Intentar habilitar un tipo de comprobante que tu plan no incluye (p. ej. notas de crédito en Free/Starter) devuelve `402 DOCUMENT_TYPE_NOT_IN_TIER` — consulta [Issuer Document Types](endpoints/document-types.md).

---

## Idempotencia

`POST /v1/documents` acepta un encabezado opcional `Idempotency-Key`. Si reintentas la misma solicitud después de un timeout, envía la misma llave — la API devuelve el comprobante existente en lugar de crear un duplicado. Usa una llave única por factura que pretendas crear (p. ej. un UUID), y mantenla consistente entre reintentos.

---

## Límite de tasa

Las solicitudes tienen un límite de tasa por llave API según tu tier de suscripción (ver tabla arriba). Cuando excedes el límite, la API devuelve [`429 Too Many Requests`](errors/too-many-requests.md). Implementa retroceso exponencial: espera 1s, luego 2s, luego 4s antes de reintentar.

`POST /v1/register` tiene además un límite de **5 solicitudes por hora por dirección IP**, sin importar el tier.

---

## Estados del comprobante

| Estado | Significado | Siguiente paso |
|---|---|---|
| `SIGNED` | Creado y firmado, aún no enviado al SRI | Enviar al SRI |
| `RECEIVED` | Aceptado por el SRI para procesamiento | Consultar autorización |
| `RETURNED` | El SRI rechazó el comprobante | Reconstruir y reenviar |
| `AUTHORIZED` | Autorizado por el SRI — legalmente válido | Completado |
| `NOT_AUTHORIZED` | El SRI no lo autorizó | Reconstruir y reenviar |
