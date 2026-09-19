# Primeros Pasos

## URL base

```
https://api.comprobify.com/v1
```

Todos los ejemplos de este sitio usan rutas relativas a esa base (p. ej. `POST /v1/documents` significa `POST https://api.comprobify.com/v1/documents`).

## Colección de Postman

Importa la colección completa para probar cada endpoint directamente desde Postman — todas las solicitudes vienen preconfiguradas con variables para tu URL base, tu API key y tu clave de acceso.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/15935880-2sBXiqE8vL)

> **Configuración inicial:** después de importar, abre la colección, ve a **Variables**, y configura `base_url` como `https://api.comprobify.com` y `api_key` con tu API key. Después de crear una factura, copia el `accessKey` devuelto en la variable `access_key`.

También puedes descargar el JSON de la colección directamente: [`comprobify.postman_collection.json`](https://raw.githubusercontent.com/novaej/comprobify/main/postman/comprobify.postman_collection.json)

---

## 1. Crea tu cuenta (en la aplicación web, no por API)

La creación de la cuenta no es un endpoint invocable por terceros — se hace en la **aplicación web de Comprobify**. Al terminar, tu cuenta ya tiene un emisor y una llave de sandbox completamente funcional, pero, por diseño, la aplicación web **no te muestra su texto**: la guarda cifrada y la usa internamente para operar tu panel. Eso está bien si solo vas a usar el panel; si necesitas integrar tu propio sistema directamente contra la API, sigue leyendo — la sección 3 más abajo explica cómo obtener una llave que sí puedas copiar.

La cuenta comienza en el plan **FREE** y todos los comprobantes se envían al ambiente de pruebas del SRI hasta que pases a producción. Ver [Tu cuenta y la aplicación web](account-lifecycle.md) para el detalle del registro y de la recuperación de cuenta.

---

## 2. Verifica tu correo

La aplicación web te envía un correo de verificación; haz clic en el enlace para activar tu cuenta. Puedes emitir facturas de sandbox de inmediato sin verificar, pero se requiere verificación antes de crear sucursales, generar llaves, iniciar una suscripción o pasar a producción. Ver [Tu cuenta y la aplicación web](account-lifecycle.md#verificar-tu-correo).

---

## 3. Autentica las solicitudes

Incluye tu API key como token Bearer en cada solicitud de comprobante:

```http
Authorization: Bearer <your-api-key>
```

La llave se hashea con SHA-256 en cada solicitud — el texto plano nunca se persiste después de la creación. Si una llave se ve comprometida, contacta a soporte para revocarla y emitir una nueva.

> **¿Qué necesito para usar la API directamente?** La llave que tu cuenta recibe al registrarte (ver la sección 1 arriba) tiene todos los permisos y cubre todas tus sucursales — pero la aplicación web nunca te muestra su texto, la usa internamente para operar tu panel. Para integrar tu propio sistema (backend, script, ERP) necesitas una llave que puedas copiar, y la única forma de obtener una es generar una nueva vía `POST /v1/keys` desde `/settings/api-keys` en el panel — esa sí se te muestra una vez, al crearla. Generar llaves de esta forma (y registrar webhooks propios vía `POST /v1/webhooks`) son funciones de los planes Starter en adelante — ver "Múltiples llaves con nombre por tenant" más abajo. **Free/Solo/Lite no incluyen acceso directo a la API** — la llave de tu cuenta la usa únicamente la aplicación web; para integrar tu propio sistema necesitas un plan Starter o superior.

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

### Múltiples llaves con nombre por tenant (Starter en adelante)

**Free/Solo/Lite no pueden generar llaves por self-service en absoluto — ni siquiera una.** Estos planes no incluyen acceso directo a la API: la llave inicial que creó el registro la usa únicamente la aplicación web (ver la sección 3 arriba), y para integrar tu propio sistema necesitas un plan Starter o superior. A partir de Starter, dado que una sola llave vinculada al tenant cubre todas tus sucursales, puedes generar llaves con nombre vía `POST /v1/keys` (mostradas una vez, al crearlas) para rastrear qué integración está haciendo cada llamada (frontend, ERP, app móvil, etc.):

```http
POST /v1/keys
Authorization: Bearer <your-api-key>
Content-Type: application/json

{ "label": "ERP integration", "environment": "sandbox" }
```

Usa `GET /v1/keys` para listarlas y `DELETE /v1/keys/:id` para revocar una. `environment` por defecto es `sandbox`; generar una llave `production` requiere que el tenant ya se haya promovido. Todas las llaves bajo el mismo tenant pueden operar sobre el mismo conjunto de sucursales — la diferencia está en la observabilidad (qué integración hizo la llamada) y en la revocación granular (revocar una integración comprometida sin afectar a las demás). `GET /v1/keys` ya incluye `lastUsedAt`/`requestCount` por llave y un bloque `limit: { max, used }` con cuántas llaves puedes crear todavía, y [`GET /v1/keys/:id/usage`](endpoints/api-keys.md#uso-diario-de-una-llave) devuelve una serie diaria lista para graficar — útil para detectar una llave sin uso o un pico de tráfico inesperado.

### Ciclo de vida de las llaves

| Etapa | Ambiente de la llave | Qué hacer |
|---|---|---|
| Después del registro | Sandbox | La aplicación web la usa para operar tu panel de inmediato; no necesitas su texto para eso. |
| Después de promover a producción (desde la aplicación web) | Producción | Todas las llaves de sandbox se revocan y se crean sus equivalentes de producción — esto ocurre dentro de la aplicación web, que te muestra una sola vez el texto de las llaves con nombre que hayas creado (la llave interna de tu cuenta nunca se muestra). |
| Agregando integraciones propias (Starter+) | Mismo tenant | Genera llaves con nombre vía `POST /v1/keys` para observabilidad por integración. |
| Llave con nombre perdida (Starter+) | — | Genera un reemplazo vía `POST /v1/keys`, revoca la anterior vía `DELETE /v1/keys/:id`. |

### ¿Por qué llaves vinculadas al tenant?

Una sola llave cubre toda tu cuenta, así que un frontend o ERP que opera sobre múltiples sucursales no tiene que manejar credenciales separadas. La trazabilidad por integración proviene de llaves con nombre (`frontend-prod`, `erp`, `mobile`) en lugar de llaves por sucursal. Revocar una llave filtrada solo afecta a la integración que la usaba; las demás llaves siguen funcionando.

---

## 4. Registra un endpoint de webhook (recomendado, Starter en adelante)

Registra una URL HTTPS en tu servidor para recibir notificaciones de eventos casi en tiempo real — autorizaciones de comprobantes, alertas de certificados, y cualquier futuro tipo de evento que la API produzca.

**Los webhooks propios son una función de los planes Starter en adelante** — Free/Solo/Lite no pueden registrar un endpoint (ver la tabla de planes abajo). Si estás en uno de esos planes, o simplemente no puedes exponer una URL pública todavía, usa el sondeo descrito al final de esta sección — funciona en todos los planes sin excepción.

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

Omite `eventTypes` (o pasa `[]`) para suscribirte a todos los tipos de evento. Puedes registrar hasta el límite de tu plan (Free/Solo/Lite: 0 — no disponible; Starter: 2, Growth: 5, Business: 10, Enterprise: 20) y gestionarlos vía `GET / PATCH / DELETE /v1/webhooks`. `GET /v1/webhooks` incluye un bloque `limit: { max, used }` para que puedas verificar cuánto espacio te queda sin adivinar.

> **Si no puedes exponer una URL HTTPS pública** (desarrollo local, detrás de un firewall), sondea `GET /v1/notifications?sinceId=<lastId>` en su lugar. Guarda el `id` de la notificación más reciente que recibiste en cada sondeo y pásalo como `sinceId` en la siguiente solicitud para ponerte al día de forma eficiente — consulta [Notificaciones](endpoints/notifications.md).

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

Una vez que hayas verificado tu correo, aceptado los acuerdos legales y probado tu integración en sandbox, la promoción a producción se hace desde la **aplicación web**, no por API. Es de una sola dirección: se revocan tus llaves de sandbox, se crean las equivalentes de producción (la aplicación web te muestra **una sola vez** el texto de las que hayas creado tú — cópialas en ese momento), y todos los comprobantes posteriores de cualquier sucursal van al ambiente de producción del SRI (`ambiente = 2`). Ver [Tu cuenta y la aplicación web](account-lifecycle.md#pasar-a-produccion).

---

## Planes de suscripción

Los precios listados son la tarifa **sin IVA** (el "precio de etiqueta") — el IVA (15% actualmente) se añade al momento de pagar, nunca está incluido en la cifra publicada. Entre paréntesis se muestra el total con IVA incluido, que es lo que efectivamente transfieres.

| Plan | Precio/mes (+ IVA) | Precio/año (+ IVA) | Cuota de comprobantes **(cifra mensual base)** | Tipos de comprobante | Sucursales máx. | Puntos de emisión máx. por sucursal | Endpoints de webhook máx.¹ | Llaves API máx.¹ | Límite de escritura |
|---|---|---|---|---|---|---|---|---|---|
| Free | $0 | — (solo mensual) | 5 | Factura (`01`) | 1 | 1 | 0 | 0 | 10 req/min |
| Solo | — (solo anual) | $45 (+IVA $51.75) | 20 | Factura (`01`) | 1 | 1 | 0 | 0 | 15 req/min |
| Lite | $12 (+IVA $13.80) | $120 (+IVA $138) | 50 | Factura (`01`) | 1 | 1 | 0 | 0 | 30 req/min |
| Starter | $20 (+IVA $23) | $200 (+IVA $230) | 200 | Factura (`01`) | 3 | 2 | 2 | 5 | 60 req/min |
| Growth | $90 (+IVA $103.50) | $900 (+IVA $1,035) | 1,000 | Factura, Nota de Crédito (`01`, `04`) | 10 | 5 | 5 | 10 | 120 req/min |
| Business | $230 (+IVA $264.50) | $2,300 (+IVA $2,645) | 4,000 | Factura, Nota de Crédito (`01`, `04`) | Ilimitado | Ilimitado | 10 | 20 | 300 req/min |
| Enterprise | $450 (+IVA $517.50) | $4,500 (+IVA $5,175) | **Ilimitado** | Factura, Nota de Crédito (`01`, `04`) | Ilimitado | Ilimitado | 20 | Ilimitado | 600 req/min |

**Free es solo mensual** — nunca se compra realmente (no hay una suscripción detrás), así que no existe una variante anual a la que cambiar. **Solo es solo anual** (facturación mensual no disponible en ese plan) — un compromiso anual de bajo costo pensado para el escalón de entrada, por debajo de Starter. **Enterprise no tiene cuota de comprobantes**: es genuinamente ilimitado (no un número grande), y tampoco tiene tarifa de excedente, porque no hay tope que exceder.

¹ **En Free/Solo/Lite, "0" significa que el plan no incluye acceso directo a la API.** Estas dos columnas son cuántas llaves/webhooks puedes crear tú mismo — generar llaves y registrar webhooks propios son funciones de Starter en adelante. Tu llave inicial del registro existe y funciona, pero la aplicación web nunca te muestra su texto (la usa internamente para operar tu panel), así que esos planes no incluyen acceso directo a la API — para integrar tu propio sistema, sube a Starter o superior. Consulta la nota de "¿Qué necesito para usar la API directamente?" en la sección 3.

> **Nota:** estos precios reflejan el catálogo publicado en este momento y pueden cambiar — todo cambio de precio requiere al menos 30 días de aviso previo a los tenants activos (ver [Tu suscripción y cómo pagarla](paying-your-subscription.md)), así que un precio nunca cambia de un día para otro. Consulta siempre la aplicación web de Comprobify para el catálogo vigente en tiempo real; esta tabla es una referencia y puede quedar desactualizada entre ediciones de esta página.

**El pago anual no solo cambia con qué frecuencia pagas — también cambia cómo se consume tu cuota.** En un plan **mensual**, la cuota de la tabla es tu tope y se reinicia cada mes. En un plan **anual**, esa misma cifra se multiplica por 12 y se otorga de una sola vez para todo el año — puedes consumirla de forma despareja (por ejemplo, 0 comprobantes en enero y 480 en diciembre en un plan con cuota de 40/mes) en lugar de perder lo que no usaste cada mes.

La cuota de comprobantes se comparte entre todas las sucursales y tipos de comprobante, y cuenta **solo los comprobantes de producción** — los comprobantes de sandbox/prueba nunca la consumen. Cuando la alcanzas, `POST /v1/documents` devuelve `402 QUOTA_EXCEEDED`. Consulta "Mejorando a un plan pagado" abajo.

> **Cuota mensual o anual, según cómo pagues.** En facturación mensual, tu cuota se reinicia al comienzo de cada mes. En facturación anual, tu cuota es un cupo único para los 12 meses (cifra mensual × 12), consumible de forma pareja o despareja durante todo el año — no se reinicia cada mes. El plan **Enterprise** no tiene cuota: es ilimitado. Solo los comprobantes de producción cuentan contra la cuota.

### Mejorando a un plan pagado

**La facturación se gestiona desde la aplicación web de Comprobify, no por API.** Ahí eliges un plan y pagas con tarjeta (activo en segundos) o por transferencia bancaria (tu proveedor revisa el comprobante y luego se activa). No hay endpoints que integrar para nada de esto.

Consulta [Tu suscripción y cómo pagarla](paying-your-subscription.md) para el recorrido completo: los dos métodos de pago, renovaciones y período de gracia, cambios de plan, cancelación, [usuarios adicionales](paying-your-subscription.md#usuarios-adicionales), y el aviso de 30 días por cambio de precio.

Lo que sí puedes hacer por API es seguir el resultado:

- [`GET /v1/tenants/me`](endpoints/tenant-me.md) — tu plan, cuota, usuarios adicionales y estado de cuenta actuales. `subscriptionTier`/`documentQuota` se actualizan en el momento en que un pago se verifica.
- [Notificaciones](endpoints/notifications.md) — `PAYMENT_VERIFIED`, `PAYMENT_REJECTED`, `SUBSCRIPTION_RENEWAL_DUE`, `SUBSCRIPTION_EXPIRED` y más, entregadas a tus [webhooks](endpoints/webhooks.md) si tienes alguno registrado. No hace falta consultar activamente.
- La aplicación web de Comprobify — el catálogo de planes y precios vigentes se consulta ahí, no hay un endpoint público equivalente pensado para integradores externos.

Hasta que un pago se verifique estás en los límites FREE en producción — nada se bloquea, solo no tienes la cuota mayor todavía.

Intentar crear una sucursal más allá del límite del plan devuelve `402 BRANCH_LIMIT_REACHED` / `ISSUE_POINT_LIMIT_REACHED`. Intentar habilitar un tipo de comprobante que tu plan no incluye (p. ej. notas de crédito en Free/Starter) devuelve `402 DOCUMENT_TYPE_NOT_IN_TIER` — consulta [Issuer Document Types](endpoints/document-types.md).

---

## Idempotencia

`POST /v1/documents` acepta un encabezado opcional `Idempotency-Key`. Si reintentas la misma solicitud después de un timeout, envía la misma llave — la API devuelve el comprobante existente en lugar de crear un duplicado. Usa una llave única por factura que pretendas crear (p. ej. un UUID), y mantenla consistente entre reintentos.

---

## Límite de solicitudes

Cada API key tiene un límite de solicitudes por minuto según tu plan de suscripción (ver tabla arriba). Cuando excedes el límite, la API devuelve [`429 Too Many Requests`](errors/too-many-requests.md). Implementa retroceso exponencial: espera 1s, luego 2s, luego 4s antes de reintentar.

---

## Estados del comprobante

| Estado | Significado | Siguiente paso |
|---|---|---|
| `SIGNED` | Creado y firmado, aún no enviado al SRI | Enviar al SRI |
| `RECEIVED` | Aceptado por el SRI para procesamiento | Consultar autorización |
| `RETURNED` | El SRI rechazó el comprobante | Reconstruir y reenviar |
| `AUTHORIZED` | Autorizado por el SRI — legalmente válido | Completado |
| `NOT_AUTHORIZED` | El SRI no lo autorizó | Reconstruir y reenviar |
