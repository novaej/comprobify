# Listar Emisores

Devuelve todos los emisores activos (sucursales / puntos de emisión) que pertenecen al tenant autenticado.

```
GET /v1/issuers
```

## Autenticación

`Authorization: Bearer <api-key>`

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "issuers": [
    {
      "id": "00000000-0000-0000-0000-000000000001",
      "ruc": "1234567890001",
      "businessName": "ACME S.A.",
      "tradeName": "ACME",
      "branchCode": "001",
      "issuePointCode": "001",
      "branchAddress": "Av. Amazonas 123",
      "certFingerprint": "AA:BB:CC:...",
      "certExpiry": "2027-01-01T00:00:00.000Z"
    }
  ]
}
```

### Campos del emisor

| Campo | Descripción |
|---|---|
| `id` | UUID del emisor — pásalo como `X-Issuer-Id` en las solicitudes de comprobantes |
| `ruc` | RUC del contribuyente |
| `businessName` | Razón social |
| `tradeName` | Nombre comercial (null si no está definido) |
| `branchCode` | Código de sucursal de 3 dígitos del SRI |
| `issuePointCode` | Código de punto de emisión de 3 dígitos del SRI |
| `branchAddress` | Dirección de la sucursal (null si no está definida) |
| `certFingerprint` | Huella digital del certificado (null si no hay certificado cargado) |
| `certExpiry` | Fecha de vencimiento del certificado (null si no hay certificado cargado) |

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `UNAUTHORIZED` | 401 | Llave API faltante o inválida |
