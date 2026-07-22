# Crear Sucursal / Punto de Emisión

Crea una nueva sucursal o punto de emisión para el tenant autenticado. El nuevo emisor hereda el RUC, la razón social y el certificado de un emisor existente del tenant. **No se genera ninguna API key nueva** — tu llave de tenant existente ya cubre todas las sucursales mediante el header `X-Issuer-Id`.

```
POST /v1/issuers
```

## Autenticación

`Authorization: Bearer <api-key>`

## Límite de tasa

Limitador de escritura — depende del plan (10–300 solicitudes/min por API key).

## Cuerpo de la solicitud

`multipart/form-data`. Si no se sube ningún archivo P12, la nueva sucursal reutiliza el certificado de otro de tus emisores existentes.

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `branchCode` | string | Sí | Código de sucursal SRI de 3 dígitos, p. ej. `002` |
| `issuePointCode` | string | Sí | Código de punto de emisión SRI de 3 dígitos, p. ej. `001` |
| `branchAddress` | string | No | Dirección de la sucursal (máx. 300 caracteres) |
| `documentTypes` | array | No | Códigos de tipo de comprobante a habilitar (por defecto: `["01"]`) — restringido por tu plan, igual que [Agregar un tipo de comprobante](document-types.md#document-type-tier-limits) |
| `initialSequentials` | array | No | Números secuenciales iniciales: `[{ "documentType": "01", "sequential": 1 }]` |
| `sourceIssuerId` | string (UUID) | No | UUID del emisor del cual heredar el certificado/perfil. Por defecto, el primer emisor existente del tenant. Se ignora si se sube un archivo `cert`. |
| `cert` | file | No | Archivo de certificado P12 — solo necesario si esta sucursal usa un certificado distinto |
| `certPassword` | string | No | Contraseña del P12 — solo al proporcionar un archivo `cert` |

### Heredado del emisor de origen

Cuando no se sube ningún archivo P12, los siguientes campos se copian del emisor de origen (ya sea el nombrado en `sourceIssuerId` o el primer emisor del tenant):

- `ruc`, `businessName`, `tradeName`, `mainAddress`
- `emissionType`, `requiredAccounting`, `specialTaxpayer`
- Datos del certificado (`encryptedPrivateKey`, `certificatePem`, `certFingerprint`, `certExpiry`)

### Límites del plan

| Plan | Máx. sucursales | Máx. puntos de emisión por sucursal |
|---|---|---|
| FREE | 1 | 1 |
| STARTER | 3 | 2 |
| GROWTH | 10 | 5 |
| BUSINESS | Ilimitado | Ilimitado |

Una nueva sucursal se cuenta cuando el `branchCode` aún no existe para el tenant. Agregar un segundo punto de emisión a una sucursal existente cuenta contra `maxIssuePointsPerBranch`.

## Respuesta

**201 Created**

```json
{
  "ok": true,
  "issuer": {
    "id": "00000000-0000-0000-0000-000000000002",
    "ruc": "1712345678001",
    "businessName": "My Company S.A.",
    "tradeName": "My Company",
    "branchCode": "002",
    "issuePointCode": "001",
    "branchAddress": "Av. 6 de Diciembre 123",
    "certFingerprint": "SHA256:...",
    "certExpiry": "2027-01-01T00:00:00.000Z"
  }
}
```

El `id` devuelto es lo que pasas como `X-Issuer-Id` en las solicitudes de comprobantes dirigidas a esta sucursal. Las sucursales nuevas heredan el ambiente actual del tenant (sandbox o producción). Usa [`POST /v1/tenants/promote`](promote-tenant.md) para promover todo el tenant a producción.

## Errores

| Estado HTTP | Código | Cuándo ocurre |
|---|---|---|
| `400` | `VALIDATION_FAILED` | Campos faltantes o inválidos, o el tenant no tiene ningún emisor existente del cual heredar y no se subió ningún P12 |
| `401` | `UNAUTHORIZED` | API key ausente o inválida |
| `402` | `BRANCH_LIMIT_REACHED` / `ISSUE_POINT_LIMIT_REACHED` | Se alcanzó el límite de sucursales o puntos de emisión para este plan |
| `402` | `DOCUMENT_TYPE_NOT_IN_TIER` | Un código de `documentTypes` solicitado no está incluido en tu plan |
| `403` | `FORBIDDEN` | El correo del tenant aún no ha sido verificado |
| `404` | `NOT_FOUND` | `sourceIssuerId` no existe o pertenece a un tenant diferente |
| `409` | `CONFLICT` | Ya existe una sucursal con esta combinación de `branchCode` + `issuePointCode` |
