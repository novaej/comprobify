# Secuenciales del Emisor

Consulta y corrige manualmente los contadores de número secuencial de un emisor. Sandbox y producción se rastrean de forma independiente (esquemas de PostgreSQL separados), por lo que ambos se reportan lado a lado.

## Autenticación

`Authorization: Bearer <api-key>`

Ambos endpoints a continuación reciben el id del emisor como parámetro de URL y verifican que pertenezca a tu tenant antes de aplicar cualquier cambio.

---

## Consultar los secuenciales actuales

```
GET /v1/issuers/:id/sequentials
```

Devuelve una fila por cada tipo de comprobante activo del emisor, con el valor actual del contador y el secuencial que produciría a continuación cada entorno.

### Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID del emisor |

### Respuesta

```json
{
  "ok": true,
  "sequentials": [
    {
      "documentType": "01",
      "sandbox": { "current": 12, "next": 13 },
      "production": { "current": 104, "next": 105 }
    },
    {
      "documentType": "04",
      "sandbox": { "current": 0, "next": 1 },
      "production": { "current": 0, "next": 1 }
    }
  ]
}
```

Un tipo de comprobante que nunca ha emitido un comprobante en un entorno reporta `current: 0`, `next: 1`.

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `id` no es un entero positivo |
| `401` | `UNAUTHORIZED` | Llave API faltante o inválida |
| `403` | `ISSUER_FORBIDDEN` | El emisor pertenece a otro tenant |
| `404` | `ISSUER_NOT_FOUND` | Emisor no encontrado o inactivo |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |

---

## Establecer el siguiente secuencial

```
PATCH /v1/issuers/:id/sequentials/:documentType
```

Establece manualmente el contador para un tipo de comprobante en un entorno, de modo que el siguiente comprobante creado tome `nextSequential`. Se usa típicamente para corregir un contador después de migrar desde otro sistema de facturación, o para saltar un bloque de números ya usados fuera de la API.

La escritura bloquea la fila del contador (`SELECT ... FOR UPDATE`) dentro de la misma transacción que la actualiza, por lo que no puede entrar en carrera con una llamada concurrente a `POST /v1/documents` y producir un secuencial duplicado.

### Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID del emisor |
| `documentType` | Código de tipo de comprobante del SRI (por ejemplo, `01`) |

### Cuerpo de la solicitud

```json
{
  "environment": "production",
  "nextSequential": 200
}
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `environment` | string | Sí | `sandbox` o `production` |
| `nextSequential` | integer | Sí | El secuencial que debe recibir el siguiente comprobante de este tipo/entorno. Debe ser mayor que el valor actual del contador. |

### Respuesta

**200 OK**

```json
{ "ok": true }
```

### Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | `documentType` no es un tipo soportado, `environment` no es `sandbox`/`production`, o `nextSequential` no es un entero positivo |
| `400` | `SEQUENTIAL_CANNOT_DECREASE` | `nextSequential` no supera el valor actual del contador |
| `401` | `UNAUTHORIZED` | Llave API faltante o inválida |
| `403` | `ISSUER_FORBIDDEN` | El emisor pertenece a otro tenant |
| `404` | `ISSUER_NOT_FOUND` | Emisor no encontrado o inactivo |
| `429` | `TOO_MANY_REQUESTS` | Se excedió el límite de tasa |
