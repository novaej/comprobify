# Envío al SRI Fallido

**Código:** `SRI_SUBMISSION_FAILED`
**Estado HTTP:** `502 Bad Gateway`

El propio servicio SOAP del SRI respondió con un código de estado HTTP fuera del rango 2xx (por ejemplo, `500`) — sí hubo respuesta, solo que no fue una válida. Es un fallo a nivel de transporte, distinto de que el SRI devuelva `RETURNED` o `NOT_AUTHORIZED` (comunicaciones exitosas en las que el SRI rechazó el contenido del comprobante) — y también distinto de un fallo de red genuino (tiempo de espera agotado, DNS, conexión rechazada), que `sri.service.js` reintenta automáticamente hasta 3 veces antes de propagar el error original sin envolver; ese caso nunca se convierte en un `SriError`/`502`.

Un estado no-2xx del SRI puede significar dos cosas muy distintas, ambas expuestas de la misma forma aquí pero distinguibles a partir del cuerpo crudo del fault SOAP (ver "Qué hacer ahora" abajo): un fault `soap:Client` (algo relacionado con la petición misma — estructura del sobre, codificación) frente a un fault `soap:Server` (un fallo interno en la propia infraestructura del SRI, por ejemplo un error de base de datos en su servicio de recepción) — este último típicamente es transitorio y vale la pena simplemente reintentarlo, el primero normalmente no.

::: warning Ya no se devuelve en ninguna respuesta HTTP
Desde el cambio a envío asíncrono al SRI respaldado por RabbitMQ, `POST /:key/send` y `GET /:key/authorize` nunca llaman al SRI dentro de la solicitud — la llamada SOAP real ocurre después, dentro de `workers/worker.js`, un proceso independiente sin ningún cliente HTTP esperando su respuesta. Por lo tanto, `SRI_SUBMISSION_FAILED` ya no puede aparecer como cuerpo de respuesta RFC 7807 para ningún cliente. Un fallo de red ahora aparece como una fila `ERROR` en la bitácora de eventos del comprobante (`GET /:accessKey/events`) en su lugar — revisa ahí, no una respuesta HTTP, cuando un comprobante parezca estancado. Esta página se mantiene como referencia histórica/de código de la API (la clase `SriError` y este valor de `code` todavía existen internamente), no como una respuesta que debas esperar analizar.
:::

## Respuesta (histórica — antes de ADR-019)

```json
{
  "type":     "https://docs.comprobify.com/errors/sri-error",
  "title":    "SRI Submission Failed",
  "status":   502,
  "code":     "SRI_SUBMISSION_FAILED",
  "detail":   "El servicio del SRI no está disponible",
  "instance": "/v1/documents/1503.../send",
  "sriMessages": [
    {
      "identifier": "35",
      "message":    "ARCHIVO NO CUMPLE ESTRUCTURA XML",
      "type":       "ERROR"
    }
  ]
}
```

El arreglo `sriMessages` contiene los mensajes de respuesta en bruto del SRI cuando están disponibles.

## Qué hacer ahora

- Revisa `GET /v1/documents/:accessKey/events` en busca de un evento `ERROR` con `operation: "SEND"` o `"AUTHORIZE"` y un campo `message` describiendo el fallo.
- Revisa también `GET /v1/documents/:accessKey/sri-responses` — un fallo no-2xx se registra ahí con `status: "HTTP_<código>"` (por ejemplo, `"HTTP_500"`), junto a las filas normales de RECEPTION/AUTHORIZATION. A diferencia del mensaje corto en la bitácora de eventos, esta fila existe específicamente para persistir el cuerpo crudo del fault SOAP (antes se descartaba por completo) — ver [Consultar Respuestas del SRI](../endpoints/get-sri-responses.md).
- Un intento fallido no necesita reintento manual al principio — `POST /v1/admin/jobs/queue-reconciliation` vuelve a publicar automáticamente el comprobante para que el worker lo intente de nuevo, hasta 5 intentos en total (`PENDING_EFFECTS_MAX_ATTEMPTS`). Si se agotan los 5, el comprobante queda estancado y tú mismo puedes recuperarlo — ver [Retry Send/Authorize](../endpoints/retry-send.md).
- El ambiente de pruebas del SRI (`celcer.sri.gob.ec`) a veces no está disponible fuera del horario laboral, y — como sugiere la distinción `soap:Client` vs `soap:Server` de arriba — también puede fallar con errores internos de su servidor sin relación con el comprobante enviado.
