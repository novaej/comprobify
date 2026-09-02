# Primeros Pasos

## URL base

```
https://api.comprobify.com/v1
```

Todos los ejemplos de este sitio usan rutas relativas a esa base (p. ej. `POST /v1/register` significa `POST https://api.comprobify.com/v1/register`).

## Colección de Postman

Importa la colección completa para probar cada endpoint directamente desde Postman — todas las solicitudes vienen preconfiguradas con variables para tu URL base, tu API key y tu clave de acceso.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/15935880-2sBXiqE8vL)

> **Configuración inicial:** después de importar, abre la colección, ve a **Variables**, y configura `base_url` como `https://api.comprobify.com` y `api_key` con tu API key. Después de crear una factura, copia el `accessKey` devuelto en la variable `access_key`.

También puedes descargar el JSON de la colección directamente: [`comprobify.postman_collection.json`](https://raw.githubusercontent.com/novaej/comprobify/main/postman/comprobify.postman_collection.json)

---

## 1. Registro

Crea tu cuenta, emisor y API key de sandbox en una sola llamada. Cada RUC solo puede registrarse una vez.

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

¿Perdiste tu API key? `POST /v1/register` ya no la recupera — usa [`POST /v1/recover`](endpoints/recover.md) en su lugar, con el mismo certificado `.p12` con el que te registraste.

---

## 2. Verifica tu correo

Se envía un correo de verificación a la dirección con la que te registraste. Haz clic en el enlace, o llama directamente a la API con el token del correo:

```http
POST /v1/verify-email
Content-Type: application/json

{ "token": "<token>" }
```

(También existe una variante heredada `GET /v1/verify-email?token=<token>` para consumidores directos de la API — ver [Verificar Correo](endpoints/verify-email.md) para el flujo completo de comprobar/confirmar y por qué está dividido así.)

Se requiere verificación de correo antes de poder promoverte a producción. Puedes emitir facturas de sandbox de inmediato sin verificar.

> Si estás integrando de forma programática y el correo no está disponible, contacta a soporte para verificar tu cuenta manualmente.

---

## 3. Autentica las solicitudes

Incluye tu API key como token Bearer en cada solicitud de comprobante:

```http
Authorization: Bearer <your-api-key>
```

La llave se hashea con SHA-256 en cada solicitud — el texto plano nunca se persiste después de la creación. Si una llave se ve comprometida, contacta a soporte para revocarla y emitir una nueva.

---

## Entendiendo las API keys y las sucursales

Este es el concepto más importante que debes entender antes de integrar.

**Una sola API key cubre toda tu cuenta (todas las sucursales).** Las API keys están **vinculadas al tenant**, no al emisor. Una llave puede operar sobre cualquiera de tus sucursales; declaras la sucursal destino a través del encabezado `X-Issuer-Id` en cada solicitud.

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

Una vez que tu correo esté verificado, llama a `POST /v1/issuers` con tu API key:

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

No se genera ninguna API key nueva — la llave que ya tienes cubre cada sucursal bajo tu tenant.

### Múltiples llaves con nombre por tenant

Dado que una sola llave vinculada al tenant cubre todas tus sucursales, puedes generar llaves adicionales vía `POST /v1/keys` para rastrear qué integración está haciendo cada llamada (frontend, ERP, app móvil, etc.):

```http
POST /v1/keys
Authorization: Bearer <your-api-key>
Content-Type: application/json

{ "label": "ERP integration", "environment": "sandbox" }
```

Usa `GET /v1/keys` para listarlas y `DELETE /v1/keys/:id` para revocar una. `environment` por defecto es `sandbox`; generar una llave `production` requiere que el tenant ya se haya promovido. Todas las llaves bajo el mismo tenant pueden operar sobre el mismo conjunto de sucursales — la diferencia está en la observabilidad (qué integración hizo la llamada) y en la revocación granular (revocar una integración comprometida sin afectar a las demás). `GET /v1/keys` ya incluye `lastUsedAt`/`requestCount` por llave, y [`GET /v1/keys/:id/usage`](endpoints/api-keys.md#uso-diario-de-una-llave) devuelve una serie diaria lista para graficar — útil para detectar una llave sin uso o un pico de tráfico inesperado.

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
- **Todas las API keys de sandbox activas se revocan** y se crea una llave de producción por cada una de ellas, conservando la misma etiqueta
- Todos los nuevos tokens de producción se devuelven en la respuesta — **guárdalos de inmediato, se muestran solo una vez**
- Todas las sucursales se promueven a la vez — no existe la promoción por sucursal
- Todos los comprobantes posteriores de cualquier sucursal se enviarán al endpoint de producción del SRI con `ambiente = 2`

```json
{
  "ok": true,
  "apiKeys": [
    { "label": "Initial master key", "apiKey": "<production-token>" },
    { "label": "ERP integration",     "apiKey": "<production-token>" }
  ]
}
```

Distribuye cada token a la integración que anteriormente usaba la llave de sandbox con la misma etiqueta.

> Si el estado de tu cuenta es `PENDING_VERIFICATION` (correo aún no verificado), esta llamada devuelve `403`. Verifica tu correo primero.

---

## Tiers de suscripción

Los precios listados son la tarifa **sin IVA** (el "precio de etiqueta") — el IVA (15% actualmente) se añade al momento de pagar, nunca está incluido en la cifra publicada. Entre paréntesis se muestra el total con IVA incluido, que es lo que efectivamente transfieres.

| Plan | Precio/mes (+ IVA) | Precio/año (+ IVA) | Cuota de comprobantes **(cifra mensual base)** | Tipos de comprobante | Sucursales máx. | Puntos de emisión máx. por sucursal | Endpoints de webhook máx. | Límite de escritura |
|---|---|---|---|---|---|---|---|---|
| Free | $0 | $0 | 5 | Factura (`01`) | 1 | 1 | 1 | 10 req/min |
| Solo | — (solo anual) | $35 (+IVA $40.25) | 15 | Factura (`01`) | 1 | 1 | 1 | 15 req/min |
| Lite | $8 (+IVA $9.20) | $80 (+IVA $92) | 50 | Factura (`01`) | 1 | 1 | 1 | 30 req/min |
| Starter | $20 (+IVA $23) | $200 (+IVA $230) | 200 | Factura (`01`) | 3 | 2 | 2 | 60 req/min |
| Growth | $90 (+IVA $103.50) | $900 (+IVA $1,035) | 1,000 | Factura, Nota de Crédito (`01`, `04`) | 10 | 5 | 5 | 120 req/min |
| Business | $230 (+IVA $264.50) | $2,300 (+IVA $2,645) | 4,000 | Factura, Nota de Crédito (`01`, `04`) | Ilimitado | Ilimitado | 10 | 300 req/min |
| Enterprise | $450 (+IVA $517.50) | $4,500 (+IVA $5,175) | **Ilimitado** | Factura, Nota de Crédito (`01`, `04`) | Ilimitado | Ilimitado | 20 | 600 req/min |

**Solo es solo anual** (facturación mensual no disponible en ese plan) — un compromiso anual de bajo costo pensado para el escalón de entrada, por debajo de Starter. **Enterprise no tiene cuota de comprobantes**: es genuinamente ilimitado (no un número grande), y tampoco tiene tarifa de excedente, porque no hay tope que exceder.

> **Nota:** estos precios reflejan el catálogo publicado en este momento y pueden cambiar — todo cambio de precio requiere al menos 30 días de aviso previo a los tenants activos (ver [Tu suscripción y cómo pagarla](paying-your-subscription.md)), así que un precio nunca cambia de un día para otro. Consulta siempre la aplicación web de Comprobify para el catálogo vigente en tiempo real; esta tabla es una referencia y puede quedar desactualizada entre ediciones de esta página.

**El pago anual no solo cambia con qué frecuencia pagas — también cambia cómo se consume tu cuota.** En un plan **mensual**, la cuota de la tabla es tu tope y se reinicia cada mes. En un plan **anual**, esa misma cifra se multiplica por 12 y se otorga de una sola vez para todo el año — puedes consumirla de forma despareja (por ejemplo, 0 comprobantes en enero y 480 en diciembre en un plan con cuota de 40/mes) en lugar de perder lo que no usaste cada mes.

La cuota de comprobantes se comparte entre todas las sucursales y tipos de comprobante, y cuenta **solo los comprobantes de producción** — los comprobantes de sandbox/prueba nunca la consumen. Cuando la alcanzas, `POST /v1/documents` devuelve `402 QUOTA_EXCEEDED`. Consulta "Mejorando a un plan pagado" abajo.

> **Cuota mensual o anual, según cómo pagues.** En facturación mensual, tu cuota se reinicia al comienzo de cada mes. En facturación anual, tu cuota es un cupo único para los 12 meses (cifra mensual × 12), consumible de forma pareja o despareja durante todo el año — no se reinicia cada mes. El plan **Enterprise** no tiene cuota: es ilimitado. Solo los comprobantes de producción cuentan contra la cuota.

### Mejorando a un plan pagado

**La facturación se gestiona desde la aplicación web de Comprobify, no por API.** Ahí eliges un plan y pagas con tarjeta (activo en segundos) o por transferencia bancaria (tu proveedor revisa el comprobante y luego se activa). No hay endpoints que integrar para nada de esto.

Consulta [Tu suscripción y cómo pagarla](paying-your-subscription.md) para el recorrido completo: los dos métodos de pago, renovaciones y período de gracia, cambios de plan, cancelación, y el aviso de 30 días por cambio de precio.

Lo que sí puedes hacer por API es seguir el resultado:

- [`GET /v1/tenants/me`](endpoints/tenant-me.md) — tu plan, cuota y estado de cuenta actuales. `subscriptionTier`/`documentQuota` se actualizan en el momento en que un pago se verifica.
- [Notificaciones](endpoints/notifications.md) — `PAYMENT_VERIFIED`, `PAYMENT_REJECTED`, `SUBSCRIPTION_RENEWAL_DUE`, `SUBSCRIPTION_EXPIRED` y más, entregadas a tus [webhooks](endpoints/webhooks.md) si tienes alguno registrado. No hace falta consultar activamente.
- La aplicación web de Comprobify — el catálogo de planes y precios vigentes se consulta ahí, no hay un endpoint público equivalente pensado para integradores externos.

Hasta que un pago se verifique estás en los límites FREE en producción — nada se bloquea, solo no tienes la cuota mayor todavía.

Intentar crear una sucursal más allá del límite del tier devuelve `402 BRANCH_LIMIT_REACHED` / `ISSUE_POINT_LIMIT_REACHED`. Intentar habilitar un tipo de comprobante que tu plan no incluye (p. ej. notas de crédito en Free/Starter) devuelve `402 DOCUMENT_TYPE_NOT_IN_TIER` — consulta [Issuer Document Types](endpoints/document-types.md).

---

## Idempotencia

`POST /v1/documents` acepta un encabezado opcional `Idempotency-Key`. Si reintentas la misma solicitud después de un timeout, envía la misma llave — la API devuelve el comprobante existente en lugar de crear un duplicado. Usa una llave única por factura que pretendas crear (p. ej. un UUID), y mantenla consistente entre reintentos.

---

## Límite de tasa

Las solicitudes tienen un límite de tasa por API key según tu tier de suscripción (ver tabla arriba). Cuando excedes el límite, la API devuelve [`429 Too Many Requests`](errors/too-many-requests.md). Implementa retroceso exponencial: espera 1s, luego 2s, luego 4s antes de reintentar.

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
