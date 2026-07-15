# Consultar Autorización

Encola una verificación de autorización para un comprobante previamente enviado. Este endpoint es asíncrono — no consulta al SRI directamente.

```
GET /v1/documents/:accessKey/authorize
```

El comprobante debe estar en estado `RECEIVED`. Una llamada exitosa encola la verificación y retorna de inmediato — **no** espera la respuesta del SRI. Un proceso worker independiente recoge el trabajo encolado y llama al SRI; el comprobante eventualmente pasa a `AUTHORIZED` (se envía automáticamente un correo con el PDF del RIDE y el XML firmado a la dirección de correo del comprador, y se crea una notificación `DOCUMENT_AUTHORIZED` — que dispara un webhook hacia cualquier endpoint registrado y suscrito a ese tipo de evento, consulta [Webhooks](webhooks.md)) o a `NOT_AUTHORIZED` (el comprobante debe reconstruirse). No es necesario llamar a este endpoint en absoluto para eventualmente ver la transición — un job de reconciliación periódico también encola una verificación de autorización para cualquier comprobante `RECEIVED` que supere un breve retraso, así que el resultado eventual y su notificación/webhook igual llegan aunque ningún cliente lo consulte.

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (id numérico obtenido de `GET /v1/issuers`)

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `accessKey` | La clave de acceso de 49 dígitos del comprobante |

## Respuesta

**202 Accepted** — confirma que la verificación fue encolada, no el resultado.

```json
{
  "ok": true,
  "document": {
    "accessKey": "1503202601179234567800110010010000000011234567810",
    "documentType": "01",
    "sequential": "000000001",
    "status": "RECEIVED",
    "issueDate": "15/03/2026",
    "total": "115.00"
  }
}
```

`status` aquí sigue siendo `"RECEIVED"` — esta respuesta nunca refleja el resultado de la autorización. Consulta después `GET /v1/documents/:accessKey`, o espera la notificación/webhook `DOCUMENT_AUTHORIZED`. Si el comprobante termina en `NOT_AUTHORIZED`, usa [Reconstruir Factura](rebuild-invoice.md) para corregir y reenviar.

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `BAD_REQUEST` | 400 | El header `X-Issuer-Id` falta o está mal formado |
| `BAD_REQUEST` | 400 | El comprobante no está en estado `RECEIVED` |
| `UNAUTHORIZED` | 401 | Llave API ausente o inválida, o desajuste de ambiente (llave sandbox apuntando a un tenant de producción o viceversa) |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a otro tenant |
| `ACCOUNT_SUSPENDED` | 403 | La cuenta del tenant está suspendida — a diferencia de la mayoría de los demás endpoints de lectura de comprobantes (listar, obtener, RIDE, XML, eventos, notas de crédito), este permanece bloqueado durante la suspensión porque de todos modos resulta en una llamada al SRI y en el envío del correo de autorización (solo que ahora de forma asíncrona, vía el worker) — esto es "usar" el servicio, no una visualización pasiva; consulta el [catálogo de errores](../errors/index.md) |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
| `NOT_FOUND` | 404 | Comprobante no encontrado |

`SRI_SUBMISSION_FAILED` ya no puede ocurrir en este endpoint — las fallas de red/SOAP ahora ocurren dentro del worker asíncrono, después de que este endpoint ya respondió. Un intento fallido se registra como un evento de comprobante `ERROR` y el comprobante sigue siendo elegible para otro intento a través del job de reconciliación.
