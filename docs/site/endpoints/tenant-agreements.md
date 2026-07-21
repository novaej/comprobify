# Acuerdos del Tenant

Consulta y acepta las instancias personalizadas del acuerdo generadas para el tenant autenticado. Cada documento (Términos de Servicio, Política de Privacidad, DPA) se genera con la razón social y el RUC propios del tenant sustituidos en el momento del registro — el contenido almacenado es una instantánea inmutable de lo que estaba vigente cuando se creó la cuenta.

Usa [Aceptación de Acuerdos](agreement-acceptance.md) para verificar si algún documento necesita ser aceptado nuevamente. Usa `POST /v1/tenants/agreements` (en esa misma página) para registrar la aceptación.

## Listar documentos

```
GET /v1/tenants/agreements/history
```

**Autenticación:** `Authorization: Bearer <api-key>`

### Respuesta

```json
{
  "ok": true,
  "documents": [
    {
      "id": "00000000-0000-0000-0000-000000000001",
      "documentType": "TERMS",
      "templateVersion": "2026-07-01",
      "status": "ACCEPTED",
      "generatedAt": "2026-07-01T14:00:00.000Z",
      "acceptedAt": "2026-07-01T14:05:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000002",
      "documentType": "PRIVACY",
      "templateVersion": "2026-07-01",
      "status": "ACCEPTED",
      "generatedAt": "2026-07-01T14:00:00.000Z",
      "acceptedAt": "2026-07-01T14:05:00.000Z"
    },
    {
      "id": "00000000-0000-0000-0000-000000000003",
      "documentType": "DPA",
      "templateVersion": "2026-07-01",
      "status": "ACCEPTED",
      "generatedAt": "2026-07-01T14:00:00.000Z",
      "acceptedAt": "2026-07-01T14:05:00.000Z"
    }
  ]
}
```

Devuelve todas las instancias de todas las versiones, empezando por la más reciente de cada tipo. El estado es `PENDING` (generado, aún no aceptado) o `ACCEPTED`. Cuando se publica una nueva versión de plantilla, aparece aquí una nueva instancia `PENDING` tras la primera llamada a `GET /v1/tenants/agreements` o a este endpoint.

## Obtener un documento (HTML renderizado)

```
GET /v1/tenants/agreements/:type
```

**Autenticación:** `Authorization: Bearer <api-key>`

**Parámetro de URL:** `:type` debe ser `TERMS`, `PRIVACY` o `DPA`.

Devuelve el documento personalizado del tenant como una página `text/html` completa y autocontenida (con estilo, con el mismo formato de documento formal que `GET /v1/agreements/:type` — ver sus Notas) — el contenido exacto que se almacenó en el momento de la generación, incluyendo la razón social y el RUC propios del tenant donde corresponda (particularmente visible en el DPA). Se antepone un aviso que remite al buzón de soporte para consultas antes de aceptar.

Los headers de la respuesta incluyen:
- `X-Document-Status` — `PENDING` o `ACCEPTED`
- `X-Template-Version` — la versión de plantilla a partir de la cual se generó esta instancia
- `X-Accepted-At` — timestamp ISO de la aceptación (solo presente cuando el estado es `ACCEPTED`)

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `:type` no es un tipo de documento válido |
| `401` | `UNAUTHORIZED` | Llave API faltante o inválida |
| `404` | `AGREEMENT_NOT_FOUND` | Aún no se ha publicado ninguna plantilla para este tipo |
| `429` | `TOO_MANY_REQUESTS` | Límite de tasa excedido |

Ambos endpoints de esta página son de solo lectura, por lo que siguen siendo accesibles incluso si la cuenta del tenant está `SUSPENDED` — ver la entrada `ACCOUNT_SUSPENDED` en el [catálogo de errores](../errors/index.md).

## Notas

- Los documentos se generan en el registro y de forma diferida para cualquier nueva versión de plantilla cuando se llama a este endpoint o a `GET /v1/tenants/agreements` — no se necesita un paso separado para "solicitar" un documento.
- Ver el documento no cambia su estado. Llama a `POST /v1/tenants/agreements` por separado.
- Todas las instancias históricas se conservan — aceptar una nueva versión nunca sobrescribe el registro aceptado anterior. `GET /v1/tenants/agreements/history` devuelve el historial completo por tipo, ordenado del más reciente al más antiguo.
- Para la carga administrativa retroactiva de tenants ya existentes, ver `POST /v1/admin/tenants/:id/agreements`.
