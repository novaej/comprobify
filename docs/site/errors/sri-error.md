# Envío al SRI Fallido

**Código:** `SRI_SUBMISSION_FAILED`
**Estado HTTP:** `502 Bad Gateway`

Ocurrió un error de red al comunicarse con el servicio SOAP del SRI. Esto es distinto de que el SRI devuelva `RETURNED` o `NOT_AUTHORIZED` — esas son comunicaciones exitosas en las que el SRI rechazó el contenido del comprobante, no fallos de red.

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
- Un intento fallido no necesita reintento manual — `POST /v1/admin/jobs/queue-reconciliation` vuelve a publicar automáticamente el comprobante para que el worker lo intente de nuevo.
- El ambiente de pruebas del SRI (`celcer.sri.gob.ec`) a veces no está disponible fuera del horario laboral.
