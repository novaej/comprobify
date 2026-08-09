# API keys

Gestión de API keys a nivel de tenant. Crea llaves nombradas para cada integración (frontend, ERP, aplicación móvil, banco de pruebas sandbox, etc.), lístalas y revoca las filtradas o sin uso.

```
GET    /v1/keys
POST   /v1/keys
DELETE /v1/keys/:id
GET    /v1/keys/:id/usage
```

## Autenticación

`Authorization: Bearer <api-key>` — cualquier llave activa del tenant **con el scope `keys:manage`**. Cada endpoint de esta página administra llaves en sí mismas, así que una llave más restringida (p. ej. una llave de solo `documents:read`) no puede listar, crear, revocar ni ver el uso de otras llaves. Tener `keys:manage` por sí solo tampoco basta para escalar privilegios — ver la regla de contención de privilegios en [Crear una nueva llave](#crear-una-nueva-llave) más abajo. Ver [Scopes](#scopes) más abajo.

---

## Scopes

Cada llave lleva un arreglo `scopes`. Una solicitud solo se permite si los scopes de la llave incluyen el scope que exige la ruta de destino — ver [Insufficient Scope](/errors/forbidden#insufficient_scope) para el formato del error cuando no lo tiene.

| Scope | Cubre |
|---|---|
| `documents:write` | Todas las mutaciones de comprobantes (`POST /v1/documents`, `/send`, `/rebuild`, `/email-retry`, etc.) y `GET /:accessKey/authorize` (dispara una llamada en vivo al SRI y puede enviar un correo, por eso se trata como escritura). También `POST /v1/tenants/retry-failed-documents`. |
| `documents:read` | Todos los demás `GET` bajo `/v1/documents` (listar, obtener, RIDE, XML, eventos, notas de crédito, respuestas del SRI, estadísticas). |
| `issuers:read` | Todos los `GET` bajo `/v1/issuers` (listar, obtener, tipos de comprobante, secuenciales). |
| `issuers:write` | Todos los `POST`/`PATCH`/`DELETE` bajo `/v1/issuers` (creación de sucursales, actualizaciones, logo, renovación de certificado, tipos de comprobante, secuenciales). |
| `keys:manage` | Toda esta ruta `/v1/keys`. |
| `billing:manage` | `/v1/subscriptions` y `/v1/payments` completos. |
| `webhooks:manage` | `/v1/webhooks` completo. |
| `tenant:manage` | `PATCH /v1/tenants/language` y `POST /v1/tenants/agreements`. |
| `tenant:promote` | Solo `POST /v1/tenants/promote` — separado de `tenant:manage` porque emite/revoca todas las llaves del tenant y cambia de sandbox a producción de forma irreversible. |

Una llave creada sin un campo `scopes` explícito obtiene los **nueve** — acceso total, idéntico a cómo se comportaba cualquier llave antes de que existieran los scopes. Reducir el acceso es opcional: envía `scopes` al crear la llave (ver [Crear una nueva llave](#crear-una-nueva-llave) más abajo). Las lecturas básicas de identidad (`GET /v1/tenants/me`, `/agreements`, `/events`) y los endpoints de notificaciones/catálogos están exentos de scope — cualquier llave activa puede llamarlos sin importar su arreglo `scopes`.

---

## Listar llaves

```
GET /v1/keys
```

Devuelve todas las llaves activas del tenant. El token en texto plano **nunca** se devuelve — solo etiquetas, ambientes e ids.

### Respuesta

```json
{
  "ok": true,
  "keys": [
    {
      "id": "00000000-0000-0000-0000-000000000017",
      "label": "frontend-prod",
      "environment": "production",
      "scopes": ["documents:write", "documents:read", "issuers:read", "issuers:write", "keys:manage", "billing:manage", "webhooks:manage", "tenant:manage", "tenant:promote"],
      "active": true,
      "createdAt": "2026-03-01T12:00:00.000Z",
      "revokedAt": null,
      "lastUsedAt": "2026-08-07T14:22:10.000Z",
      "requestCount": 15832
    },
    {
      "id": "00000000-0000-0000-0000-000000000018",
      "label": "dashboard-readonly",
      "environment": "production",
      "scopes": ["documents:read"],
      "active": true,
      "createdAt": "2026-04-12T09:30:00.000Z",
      "revokedAt": null,
      "lastUsedAt": null,
      "requestCount": 0
    }
  ]
}
```

`lastUsedAt` (nullable, `null` si la llave nunca ha autenticado una solicitud) y `requestCount` (contador de por vida, no por ventana — para volumen acotado en el tiempo usa los logs estructurados de solicitudes o una herramienta APM) se actualizan en cada solicitud que esa llave autentica con éxito. `scopes` refleja lo que esa llave tiene permitido hacer actualmente — ver [Scopes](#scopes) arriba.

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `401` | `UNAUTHORIZED` | API key ausente o inválida |
| `403` | `INSUFFICIENT_SCOPE` | La llave usada en esta solicitud no tiene el scope `keys:manage` |

---

## Crear una nueva llave

```
POST /v1/keys
```

Crea una nueva llave a nivel de tenant. El token en texto plano se muestra **una sola vez** en la respuesta y nunca se almacena — regístralo de inmediato.

### Cuerpo de la solicitud

```json
{
  "label": "dashboard-readonly",
  "environment": "sandbox",
  "scopes": ["documents:read"]
}
```

| Campo | Tipo | Requerido | Por defecto | Descripción |
|---|---|---|---|---|
| `label` | string | No | `null` | Nombre legible para la integración (máx. 100 caracteres). Muy recomendado para fines de observabilidad. |
| `environment` | string | No | `"sandbox"` | `"sandbox"` o `"production"`. Las llaves de producción solo pueden crearse después de que el tenant haya sido promovido a producción. |
| `scopes` | string[] | No | una copia de los scopes de la llave solicitante | Arreglo no vacío, cada elemento uno de los 9 valores listados en [Scopes](#scopes) arriba. Omitirlo **no** da acceso total por defecto — clona los scopes que ya tiene la llave que hace esta llamada. |

**Contención de privilegios:** cada elemento de `scopes` debe estar ya presente en la llave que hace esta solicitud — no puedes crear una llave más amplia que la tuya, ni siquiera si tienes `keys:manage`. Una llave con acceso total puede crear cualquier combinación (incluyendo otra llave con acceso total); una llave con solo `["keys:manage", "documents:read"]` puede crear una llave con `["documents:read"]` pero no una con `["documents:write"]`.

### Respuesta

**201 Created**

```json
{
  "ok": true,
  "apiKey": "a3f8c2bd9e10...",
  "scopes": ["documents:read"]
}
```

El token en texto plano (`apiKey`) se muestra una sola vez; `scopes` refleja lo que realmente se otorgó (útil para confirmar que se aplicó el valor por defecto cuando se omitió el campo).

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `label` demasiado largo, `environment` inválido, o `scopes` está presente pero no es un arreglo no vacío de scopes válidos |
| `401` | `UNAUTHORIZED` | API key ausente o inválida |
| `403` | `FORBIDDEN` | El correo del tenant no está verificado, O se intenta crear una llave de producción antes de que algún emisor haya sido promovido |
| `403` | `INSUFFICIENT_SCOPE` | La llave usada en esta solicitud no tiene el scope `keys:manage` |
| `403` | `SCOPE_ESCALATION_FORBIDDEN` | `scopes` incluye un elemento que la llave solicitante no tiene — ver Contención de privilegios arriba |

---

## Revocar una llave

```
DELETE /v1/keys/:id
```

Marca la llave como inactiva. La llave no podrá usarse para autenticar ninguna solicitud futura.

### Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID de la llave (obtenido de `GET /v1/keys`) |

### Respuesta

**200 OK**

```json
{ "ok": true }
```

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `BAD_REQUEST` | Se intenta revocar la misma llave que se está usando para hacer esta solicitud — usa una llave diferente, o coordina con soporte de administración |
| `401` | `UNAUTHORIZED` | API key ausente o inválida |
| `403` | `INSUFFICIENT_SCOPE` | La llave usada en esta solicitud no tiene el scope `keys:manage` |
| `404` | `NOT_FOUND` | El id de la llave no existe o ya fue revocado, o pertenece a un tenant diferente |

---

## Uso diario de una llave

```
GET /v1/keys/:id/usage
```

Devuelve una serie diaria de solicitudes autenticadas con esa llave — pensada para alimentar directamente un gráfico (p. ej. Chart.js, Recharts) sin que el frontend tenga que rellenar días sin actividad.

### Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID de la llave (obtenido de `GET /v1/keys`) |

### Parámetros de consulta

| Parámetro | Tipo | Requerido | Por defecto | Descripción |
|---|---|---|---|---|
| `days` | integer | No | `30` | Cuántos días hacia atrás incluir (1–365), contando el día de hoy. |

### Respuesta

**200 OK**

```json
{
  "ok": true,
  "usage": [
    { "date": "2026-08-05", "requestCount": 0 },
    { "date": "2026-08-06", "requestCount": 128 },
    { "date": "2026-08-07", "requestCount": 342 }
  ]
}
```

La serie viene **rellenada con ceros** — siempre hay exactamente `days` entradas, una por cada día del rango, aunque la llave no se haya usado ese día. El id puede pertenecer a una llave ya revocada (la propiedad, no el estado `active`, es lo que da acceso) para poder seguir consultando el historial de una llave revocada.

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` no es un UUID válido, o `days` está fuera del rango 1–365 |
| `401` | `UNAUTHORIZED` | API key ausente o inválida |
| `403` | `INSUFFICIENT_SCOPE` | La llave usada en esta solicitud no tiene el scope `keys:manage` |
| `404` | `NOT_FOUND` | El id de la llave no existe o pertenece a un tenant diferente |

---

## Ambiente de la llave + emisor de destino

Cuando una llave se usa en una solicitud de comprobante, el middleware `resolveIssuer` valida que el `environment` de la llave coincida con el ambiente efectivo del emisor de destino. El indicador `sandbox` reside en el **tenant** — `resolveIssuer` lee `tenant.sandbox` y rechaza cualquier desajuste entre llave y emisor:

| Ambiente de la llave | `sandbox` del tenant | Resultado |
|---|---|---|
| `sandbox` | `true` | OK |
| `sandbox` | `false` | `401` — una llave sandbox no puede dirigirse a un tenant de producción |
| `production` | `true` | `401` — una llave de producción no puede dirigirse a un tenant sandbox |
| `production` | `false` | OK |

Esta es la única salvaguarda que evita solicitudes accidentales entre ambientes; trata el ambiente como parte de la identidad de la llave, similar a la convención `sk_test_…` vs `sk_live_…` de Stripe.
