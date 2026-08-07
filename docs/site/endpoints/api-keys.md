# API keys

Gestión de API keys a nivel de tenant. Crea llaves nombradas para cada integración (frontend, ERP, aplicación móvil, banco de pruebas sandbox, etc.), lístalas y revoca las filtradas o sin uso.

```
GET    /v1/keys
POST   /v1/keys
DELETE /v1/keys/:id
GET    /v1/keys/:id/usage
```

## Autenticación

`Authorization: Bearer <api-key>` — cualquier llave activa del tenant.

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
      "active": true,
      "createdAt": "2026-03-01T12:00:00.000Z",
      "revokedAt": null,
      "lastUsedAt": "2026-08-07T14:22:10.000Z",
      "requestCount": 15832
    },
    {
      "id": "00000000-0000-0000-0000-000000000018",
      "label": "erp-integration",
      "environment": "production",
      "active": true,
      "createdAt": "2026-04-12T09:30:00.000Z",
      "revokedAt": null,
      "lastUsedAt": null,
      "requestCount": 0
    }
  ]
}
```

`lastUsedAt` (nullable, `null` if the key has never authenticated a request) and `requestCount` (lifetime counter, not windowed — for time-boxed volume use the structured request logs or an APM tool) update on every request that key successfully authenticates.

---

## Crear una nueva llave

```
POST /v1/keys
```

Crea una nueva llave a nivel de tenant. El token en texto plano se muestra **una sola vez** en la respuesta y nunca se almacena — regístralo de inmediato.

### Cuerpo de la solicitud

```json
{
  "label": "mobile-app",
  "environment": "sandbox"
}
```

| Campo | Tipo | Requerido | Por defecto | Descripción |
|---|---|---|---|---|
| `label` | string | No | `null` | Nombre legible para la integración (máx. 100 caracteres). Muy recomendado para fines de observabilidad. |
| `environment` | string | No | `"sandbox"` | `"sandbox"` o `"production"`. Las llaves de producción solo pueden crearse después de que el tenant haya sido promovido a producción. |

### Respuesta

**201 Created**

```json
{
  "ok": true,
  "apiKey": "a3f8c2bd9e10..."
}
```

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `label` demasiado largo o `environment` inválido |
| `401` | `UNAUTHORIZED` | API key ausente o inválida |
| `403` | `FORBIDDEN` | El correo del tenant no está verificado, O se intenta crear una llave de producción antes de que algún emisor haya sido promovido |

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
