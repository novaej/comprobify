# Error Interno del Servidor

**Código:** `INTERNAL_ERROR`
**Estado HTTP:** `500 Internal Server Error`

Ocurrió un error inesperado en el servidor. Esto no es causado por el contenido de la solicitud.

## Respuesta

```json
{
  "type":     "https://docs.comprobify.com/errors/internal-error",
  "title":    "Internal Server Error",
  "status":   500,
  "code":     "INTERNAL_ERROR",
  "instance": "/v1/documents/1503.../send"
}
```

Nota: `detail` se omite intencionalmente para evitar filtrar información interna.

## Qué hacer

- Reintenta la solicitud — los fallos transitorios a menudo se resuelven al reintentar
- Usa la ruta `instance` y la hora de la solicitud para correlacionar con los registros del servidor
- Si el error persiste, contacta al operador de la API
