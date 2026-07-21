# Consultar Emisor

Devuelve la información de perfil de un solo emisor propiedad del tenant autenticado.

```
GET /v1/issuers/:id
```

> **Migrado desde `GET /v1/issuers/me`** (eliminado en mayo de 2026). Dado que las llaves API están ahora asociadas al tenant, "el emisor actual" ya no está bien definido — debes nombrar el emisor por su id. Lista todos los emisores de tu tenant con `GET /v1/issuers`.

## Autenticación

`Authorization: Bearer <api-key>`

## Parámetros de ruta

| Parámetro | Descripción |
|---|---|
| `id` | UUID del emisor (obtenido de `GET /v1/issuers`) |

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "issuer": {
    "id": "00000000-0000-0000-0000-000000000001",
    "ruc": "1791234567001",
    "businessName": "ACME S.A.",
    "tradeName": "ACME",
    "branchCode": "001",
    "issuePointCode": "001",
    "branchAddress": "Av. Amazonas 123",
    "certFingerprint": "a1b2c3d4e5f6...",
    "certExpiry": "2027-03-15T00:00:00.000Z"
  }
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string (UUID) | UUID del emisor — usado como `X-Issuer-Id` en las solicitudes de comprobantes |
| `ruc` | string | RUC de 13 dígitos (identificación tributaria) |
| `businessName` | string | Razón social |
| `tradeName` | string \| null | Nombre comercial, si está definido |
| `branchCode` | string | Código de sucursal SRI de 3 dígitos |
| `issuePointCode` | string | Código de punto de emisión SRI de 3 dígitos |
| `branchAddress` | string \| null | Dirección de la sucursal, si está definida |
| `certFingerprint` | string \| null | Huella SHA-256 del certificado de firma |
| `certExpiry` | string \| null | Marca de tiempo ISO 8601 de expiración del certificado de firma |

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `UNAUTHORIZED` | 401 | Llave API ausente o inválida |
| `FORBIDDEN` | 403 | El emisor existe pero pertenece a otro tenant |
| `NOT_FOUND` | 404 | El id del emisor no existe o está inactivo |
