# Enviar al SRI

Encola el documento XML firmado para su envío al servicio SOAP del SRI. Este endpoint es asíncrono — no llama al SRI directamente.

```
POST /v1/documents/:accessKey/send
```

El comprobante debe estar en estado `SIGNED`. Una llamada exitosa lo mueve inmediatamente a `PENDING_SEND` y retorna — **no** espera al SRI. Un proceso worker independiente recoge el trabajo encolado y llama al SRI; el comprobante eventualmente pasa a `RECEIVED` (el SRI lo aceptó para procesamiento) o `RETURNED` (el SRI lo rechazó — se requiere reconstrucción). Consulta [Consultar Comprobante](get-document.md) o [Consultar Eventos](get-events.md) para observar esa transición, o confía en el sistema de notificaciones/webhooks para el resultado final `AUTHORIZED` una vez que también hayas llamado a [Verificar Autorización](check-authorization.md).

Si RabbitMQ no está disponible momentáneamente cuando llamas a este endpoint, el comprobante igual pasa de forma duradera a `PENDING_SEND` — no se pierde nada. Un job de reconciliación periódico vuelve a encolar cualquier envío cuyo despacho nunca fue confirmado.

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (UUID obtenido de `GET /v1/issuers`)

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `accessKey` | La clave de acceso de 49 dígitos del comprobante a enviar |

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
  }
}
```

Esta respuesta solo confirma que el comprobante fue encolado — no refleja el resultado del SRI. Verifica más tarde mediante `GET /v1/documents/:accessKey` si el comprobante llegó a `RECEIVED` o `RETURNED`. Si quedó en `RETURNED`, corrígelo con [Reconstruir Comprobante](rebuild-invoice.md) antes de volver a enviarlo.

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `BAD_REQUEST` | 400 | El header `X-Issuer-Id` falta o tiene un formato inválido |
| `BAD_REQUEST` | 400 | El comprobante no está en estado `SIGNED` |
| `UNAUTHORIZED` | 401 | API key faltante o inválida, o hay un desajuste de entorno (una llave de sandbox apuntando a un tenant de producción o viceversa) |
| `FORBIDDEN` | 403 | El emisor indicado en `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor indicado en `X-Issuer-Id` no existe |
| `NOT_FOUND` | 404 | Comprobante no encontrado |

`SRI_SUBMISSION_FAILED` ya no puede ocurrir en este endpoint — las fallas de red/SOAP ahora suceden dentro del worker asíncrono, después de que este endpoint ya respondió. Un intento fallido se registra como un evento `ERROR` del comprobante, y el comprobante permanece elegible para un nuevo intento mediante el job de reconciliación.
