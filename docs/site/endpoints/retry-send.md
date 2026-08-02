# Reintentar Envío/Autorización

Recupera un comprobante cuyo despacho asíncrono al SRI (envío o verificación de autorización) agotó sus 5 intentos automáticos y quedó estancado.

```
POST /v1/documents/:accessKey/send/retry
```

[Enviar al SRI](send-to-sri.md) y [Verificar Autorización](check-authorization.md) encolan el trabajo real y un job de reconciliación periódico (`POST /v1/admin/jobs/queue-reconciliation`, cada 5 minutos) vuelve a publicarlo automáticamente mientras siga sin confirmarse — hasta un máximo de 5 intentos (`PENDING_EFFECTS_MAX_ATTEMPTS`). Si los 5 se agotan (por ejemplo, tras una interrupción prolongada del servicio del SRI), el intento subyacente queda marcado como fallido de forma permanente y deja de reintentarse solo — este endpoint es la forma de recuperarlo: reinicia el contador de intentos a cero y lo vuelve a encolar de inmediato, sin esperar al siguiente ciclo de reconciliación.

Funciona tanto si el comprobante está estancado en `PENDING_SEND` (el envío falló) como si está `RECEIVED` esperando autorización (la verificación de autorización falló) — detecta automáticamente cuál de los dos intentos está fallido.

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (UUID obtenido de `GET /v1/issuers`)

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `accessKey` | La clave de acceso de 49 dígitos del comprobante estancado |

## Respuesta

**202 Accepted**

```json
{
  "ok": true,
  "document": {
    "accessKey": "1503202601179234567800110010010000000011234567810",
    "documentType": "01",
    "sequential": "000000001",
    "status": "PENDING_SEND",
    "issueDate": "15/03/2026",
    "total": "115.00",
    "email": {
      "status": "PENDING"
    }
  },
  "effect": {
    "id": "019fbf85-4751-7a22-82d9-479022d58b0f",
    "effectType": "SRI_SEND",
    "status": "PENDING",
    "attemptCount": 0
  }
}
```

Igual que [Enviar al SRI](send-to-sri.md), esta respuesta solo confirma que el reintento fue encolado — no el resultado del SRI. Verifica más tarde mediante `GET /v1/documents/:accessKey`, o consulta [Consultar Respuestas del SRI](get-sri-responses.md) para ver si el nuevo intento también falló (por ejemplo, con un `status` tipo `HTTP_<código>` si el SRI vuelve a fallar a nivel de transporte).

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `BAD_REQUEST` | 400 | El header `X-Issuer-Id` falta o tiene un formato inválido |
| `UNAUTHORIZED` | 401 | API key faltante o inválida, o hay un desajuste de entorno |
| `FORBIDDEN` | 403 | El emisor indicado en `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor indicado en `X-Issuer-Id` no existe |
| `NOT_FOUND` | 404 | Comprobante no encontrado |
| `NOTHING_TO_RETRY` | 409 | No hay ningún intento de envío/autorización fallido para este comprobante — puede que ya esté en curso, ya se haya completado, o nunca haya fallado |

Para recuperar varios comprobantes estancados a la vez (por ejemplo, después de una interrupción del SRI que afectó a varias sucursales), usa [Reintentar Todos los Comprobantes Fallidos](retry-failed-documents.md) en su lugar — no requiere `X-Issuer-Id`, cubre todos los emisores del tenant en una sola llamada.
