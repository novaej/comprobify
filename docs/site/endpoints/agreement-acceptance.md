# Aceptación de Acuerdos

Verifica si el tenant autenticado necesita volver a aceptar algún acuerdo, y registra una nueva aceptación cuando corresponda.

Usa esto al iniciar sesión o al cargar la aplicación para mostrar un modal de re-aceptación. Si `needsAcceptance` es `true`, muestra los documentos actualizados listados en `outdated` y llama a `POST /v1/tenants/agreements` cuando el usuario confirme.

## Verificar estado

```
GET /v1/tenants/agreements
```

**Autenticación:** `Authorization: Bearer <api-key>`

### Respuesta

#### Todo vigente — no se requiere ninguna acción

```json
{
  "ok": true,
  "agreements": {
    "needsAcceptance": false,
    "outdated": []
  }
}
```

#### Uno o más documentos actualizados desde la última aceptación

```json
{
  "ok": true,
  "agreements": {
    "needsAcceptance": true,
    "outdated": [
      {
        "documentType": "DPA",
        "currentVersion": "2026-07-01",
        "acceptedVersion": "2026-06-28",
        "url": "/v1/tenants/agreements/DPA",
        "acceptUrl": "/v1/tenants/agreements"
      }
    ]
  }
}
```

Cada entrada en `outdated` indica el tipo específico de documento que cambió. Usa la `url` para obtener y mostrar el documento actualizado antes de solicitar la re-aceptación.

| Campo | Descripción |
|---|---|
| `needsAcceptance` | `true` si algún tipo de documento tiene una nueva versión de plantilla que aún no ha sido ACCEPTED |
| `outdated[].documentType` | `TERMS`, `PRIVACY`, o `DPA` |
| `outdated[].currentVersion` | Versión de plantilla actualmente publicada |
| `outdated[].acceptedVersion` | Versión de plantilla que el tenant aceptó por última vez, o `null` si nunca la aceptó |
| `outdated[].status` | `PENDING` (generada, no aceptada), o `NOT_GENERATED` (plantilla publicada pero instancia aún no creada) |
| `outdated[].url` | URL de la instancia personalizada del documento del tenant (`GET /v1/tenants/agreements/:type`) |

**Llamar a este endpoint genera automáticamente cualquier instancia `PENDING` faltante** para nuevas versiones de plantilla — no se necesita una llamada de backfill separada después de que el administrador publique una actualización.

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `401` | `UNAUTHORIZED` | API key ausente o inválida |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |

Este es un endpoint de solo lectura, por lo que sigue siendo accesible incluso si la cuenta del tenant está `SUSPENDED` — consulta la entrada `ACCOUNT_SUSPENDED` en el [catálogo de errores](../errors/index.md).

## Registrar aceptación

```
POST /v1/tenants/agreements
```

**Autenticación:** `Authorization: Bearer <api-key>`

### Cuerpo de la solicitud

```json
{ "termsVersion": "2026-07-01" }
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `termsVersion` | string | Sí | El string de versión del documento TERMS vigente (proveniente de `GET /v1/agreements`). El servidor valida esto contra lo que está actualmente publicado antes de registrar nada. |

### Respuesta

**200 OK**

```json
{ "ok": true }
```

Registra una fila de aceptación por cada tipo de documento actualmente publicado (TERMS, PRIVACY, DPA), capturando la dirección IP y el user agent de la solicitud junto con la versión y el hash del contenido.

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `termsVersion` ausente o demasiado largo |
| `400` | `VERSION_MISMATCH` | El `termsVersion` enviado no coincide con la versión de TERMS actualmente publicada — el documento se actualizó entre el momento en que tu interfaz cargó y el momento en que el usuario hizo clic en aceptar. Vuelve a consultar `GET /v1/agreements`, muestra el contenido actualizado y solicita la aceptación nuevamente. |
| `401` | `UNAUTHORIZED` | API key ausente o inválida |
| `403` | `FORBIDDEN` | La cuenta está suspendida |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |

## Notas

- Los cambios en cualquiera de los tres documentos (TERMS, PRIVACY o DPA) de forma independiente aparecerán como un desajuste únicamente para ese tipo — los otros dos no aparecerán en `outdated` a menos que también hayan cambiado. Esto significa que una actualización exclusiva del DPA activa la re-aceptación solo del DPA, sin forzar al tenant a "re-aceptar" contenido de Términos o Privacidad que no cambió.
- La API key no necesita `X-Issuer-Id` — esta es una operación a nivel de tenant.
