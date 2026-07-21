# Actualizar Emisor

Edita el nombre comercial y/o la dirección de la sucursal de un emisor existente.

```
PATCH /v1/issuers/:id
```

## Autenticación

`Authorization: Bearer <api-key>`

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID del emisor (obtenido de `GET /v1/issuers`) |

## Cuerpo de la solicitud

Se requiere al menos un campo.

```json
{
  "tradeName": "ACME Express",
  "branchAddress": "Av. Amazonas 456"
}
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `tradeName` | string | Uno de los dos | Máximo 300 caracteres |
| `branchAddress` | string | Uno de los dos | Máximo 300 caracteres |

`businessName`, `mainAddress` y `ruc` no se pueden editar mediante este endpoint — permanecen permanentemente ligados al registro del RUC.

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "issuer": {
    "id": "00000000-0000-0000-0000-000000000001",
    "ruc": "1234567890001",
    "businessName": "ACME S.A.",
    "tradeName": "ACME Express",
    "branchCode": "001",
    "issuePointCode": "001",
    "branchAddress": "Av. Amazonas 456",
    "certFingerprint": "AA:BB:CC:...",
    "certExpiry": "2027-01-01T00:00:00.000Z"
  }
}
```

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | No se proporcionó ni `tradeName` ni `branchAddress`, o un campo supera los 300 caracteres |
| `401` | `UNAUTHORIZED` | Llave API faltante o inválida |
| `403` | `ISSUER_FORBIDDEN` | El emisor pertenece a otro tenant |
| `404` | `ISSUER_NOT_FOUND` | Emisor no encontrado o inactivo |
| `429` | `TOO_MANY_REQUESTS` | Límite de tasa excedido |
