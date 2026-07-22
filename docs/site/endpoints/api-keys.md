# API keys

Gestión de API keys a nivel de tenant. Crea llaves nombradas para cada integración (frontend, ERP, aplicación móvil, banco de pruebas sandbox, etc.), lístalas y revoca las filtradas o sin uso.

```
GET    /v1/keys
POST   /v1/keys
DELETE /v1/keys/:id
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
      "revokedAt": null
    },
    {
      "id": "00000000-0000-0000-0000-000000000018",
      "label": "erp-integration",
      "environment": "production",
      "active": true,
      "createdAt": "2026-04-12T09:30:00.000Z",
      "revokedAt": null
    }
  ]
}
```

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

## Ambiente de la llave + emisor de destino

Cuando una llave se usa en una solicitud de comprobante, el middleware `resolveIssuer` valida que el `environment` de la llave coincida con el ambiente efectivo del emisor de destino. El indicador `sandbox` reside en el **tenant** — `resolveIssuer` lee `tenant.sandbox` y rechaza cualquier desajuste entre llave y emisor:

| Ambiente de la llave | `sandbox` del tenant | Resultado |
|---|---|---|
| `sandbox` | `true` | OK |
| `sandbox` | `false` | `401` — una llave sandbox no puede dirigirse a un tenant de producción |
| `production` | `true` | `401` — una llave de producción no puede dirigirse a un tenant sandbox |
| `production` | `false` | OK |

Esta es la única salvaguarda que evita solicitudes accidentales entre ambientes; trata el ambiente como parte de la identidad de la llave, similar a la convención `sk_test_…` vs `sk_live_…` de Stripe.
