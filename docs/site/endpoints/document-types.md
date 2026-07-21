# Tipos de Comprobante del Emisor

Administra qué tipos de comprobante SRI puede procesar un emisor. La elegibilidad del tipo de comprobante se verifica al momento de crear la factura — intentar crear un comprobante de un tipo no permitido devuelve 400.

## Autenticación

`Authorization: Bearer <api-key>`

Todos los endpoints a continuación reciben el id del emisor como parámetro de URL y verifican que pertenezca a tu tenant antes de aplicar cualquier cambio.

---

## Listar tipos de comprobante

```
GET /v1/issuers/:id/document-types
```

Devuelve los tipos de comprobante activos para el emisor indicado.

### Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID del emisor (obtenido de `GET /v1/issuers`) |

### Respuesta

```json
{
  "ok": true,
  "documentTypes": ["01"]
}
```

---

## Agregar un tipo de comprobante

```
POST /v1/issuers/:id/document-types
```

Habilita un nuevo tipo de comprobante para el emisor. Si el tipo había sido removido previamente, se reactiva.

### Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID del emisor |

### Cuerpo de la solicitud

```json
{
  "documentType": "01"
}
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `documentType` | string | Sí | Código de tipo de comprobante SRI (ver tipos soportados abajo) |

### Respuesta

Devuelve la lista completa actualizada de tipos de comprobante activos.

```json
{
  "ok": true,
  "documentTypes": ["01"]
}
```

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `documentType` falta o no es un tipo soportado |
| `402` | `DOCUMENT_TYPE_NOT_IN_TIER` | El tipo está implementado pero no está incluido en tu plan de suscripción — ver los límites por plan abajo |
| `403` | `FORBIDDEN` | El emisor pertenece a otro tenant |
| `404` | `NOT_FOUND` | El id del emisor no existe |

---

## Remover un tipo de comprobante

```
DELETE /v1/issuers/:id/document-types/:code
```

Deshabilita un tipo de comprobante para el emisor. El último tipo activo no puede removerse.

### Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID del emisor |
| `code` | Código del tipo de comprobante a remover (por ejemplo, `01`) |

### Respuesta

Devuelve la lista completa actualizada de tipos de comprobante activos.

```json
{
  "ok": true,
  "documentTypes": ["01"]
}
```

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `code` no es un tipo soportado |
| `400` | `BAD_REQUEST` | Se intenta remover el último tipo de comprobante activo |
| `403` | `FORBIDDEN` | El emisor pertenece a otro tenant |
| `404` | `NOT_FOUND` | El id del emisor no existe, o el tipo de comprobante no está actualmente activo para este emisor |

---

## Tipos de comprobante soportados

| Código | Descripción |
|---|---|
| `01` | Factura (Invoice) |
| `04` | Nota de Crédito (Credit Note) — ver [Crear Nota de Crédito](create-credit-note.md) para el cuerpo de la solicitud, que difiere del de una factura |

## Límites de tipos de comprobante por plan

| Plan | Tipos permitidos |
|---|---|
| Free | Factura (`01`) |
| Starter | Factura (`01`) |
| Growth | Factura, Nota de Crédito (`01`, `04`) |
| Business | Factura, Nota de Crédito (`01`, `04`) |

Esto solo restringe **habilitar un nuevo tipo** — nunca revoca uno ya activo. Si bajas de plan, los tipos de comprobante ya habilitados en tus emisores siguen funcionando; simplemente no puedes habilitar más tipos restringidos hasta que subas de plan nuevamente.
