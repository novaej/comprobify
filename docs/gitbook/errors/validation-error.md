# Validation Error

**Code:** `VALIDATION_FAILED`
**Status:** `400 Bad Request`

One or more fields in the request body failed validation.

## Response

```json
{
  "type":     "https://novaej.gitbook.io/comprobify-api-docs/errors/validation-error",
  "title":    "Validation Failed",
  "status":   400,
  "code":     "VALIDATION_FAILED",
  "detail":   "Validation failed",
  "instance": "/api/documents",
  "errors": [
    {
      "field":   "buyer.email",
      "message": "Buyer email is required and must be a valid email address",
      "code":    "buyer.email",
      "value":   "not-an-email"
    },
    {
      "field":   "items[0].quantity",
      "message": "Item quantity must be numeric",
      "code":    "items.quantity",
      "value":   "abc"
    }
  ]
}
```

## What to do

Check the `errors` array. Each entry identifies the field that failed (`field`), what went wrong (`message`), and the value that was submitted (`value`).

The `code` on each entry is the field path with array indices stripped — use it as a stable key for field-level localized messages in your client:

```js
const fieldMessages = {
  'buyer.email':    'El correo del comprador es inválido.',
  'items.quantity': 'La cantidad debe ser un número.',
};
```
