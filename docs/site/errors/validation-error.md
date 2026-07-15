# Error de Validación

**Código:** `VALIDATION_FAILED`
**Estado HTTP:** `400 Bad Request`

Uno o más campos en el cuerpo de la solicitud fallaron la validación.

## Respuesta

```json
{
  "type":     "https://docs.comprobify.com/errors/validation-error",
  "title":    "Validation Failed",
  "status":   400,
  "code":     "VALIDATION_FAILED",
  "detail":   "La validación falló",
  "instance": "/v1/documents",
  "errors": [
    {
      "field":   "buyer.email",
      "message": "El correo del comprador es requerido y debe ser una dirección de correo válida",
      "code":    "buyer.email",
      "value":   "not-an-email"
    },
    {
      "field":   "items[0].quantity",
      "message": "La cantidad del ítem debe ser numérica",
      "code":    "items.quantity",
      "value":   "abc"
    }
  ]
}
```

## Qué hacer

Revisa el arreglo `errors`. Cada entrada identifica el campo que falló (`field`), qué salió mal (`message`), y el valor que fue enviado (`value`).

El `code` de cada entrada es la ruta del campo sin los índices de arreglo — úsalo como clave estable para mensajes localizados a nivel de campo en tu cliente:

```js
const fieldMessages = {
  'buyer.email':    'El correo del comprador es inválido.',
  'items.quantity': 'La cantidad debe ser un número.',
};
```
