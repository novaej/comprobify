# Estadísticas de Comprobantes

Devuelve un desglose por tipo de los comprobantes emitidos este mes, más un conteo histórico de comprobantes que requieren atención. Pensado para resúmenes de dashboard (por ejemplo, el widget de ingresos de comprobify-web, calculado en el cliente a partir de los valores de `authorizedTotal`).

```
GET /v1/documents/stats
```

## Autenticación

`Authorization: Bearer <api-key>` y `X-Issuer-Id: <issuer-id>` (UUID obtenido de `GET /v1/issuers`)

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "stats": {
    "thisMonth": {
      "byType": [
        { "type": "FAC", "issued": 5, "authorizedTotal": "1800.00" },
        { "type": "CRE", "issued": 2, "authorizedTotal": "260.00" }
      ]
    },
    "needsAttention": 3
  }
}
```

## Reglas de los campos

- `byType` — solo incluye los tipos de comprobante con al menos un documento emitido en el mes calendario actual (los tipos sin comprobantes se omiten)
- `authorizedTotal` — suma de `total` de los comprobantes con estado `AUTHORIZED`, como cadena decimal (`"0.00"` si no hay ninguno autorizado)
- `needsAttention` — conteo histórico de comprobantes con estado `RETURNED` o `NOT_AUTHORIZED`
- `type` — código corto del catálogo de tipos de comprobante: `'01'` → `FAC`, `'03'` → `LIQ`, `'04'` → `CRE`, `'05'` → `DEB`, `'06'` → `REM`, `'07'` → `RET`

## Errores

| Código | Estado HTTP | Cuándo ocurre |
|---|---|---|
| `BAD_REQUEST` | 400 | Falta el header `X-Issuer-Id` o está mal formado |
| `UNAUTHORIZED` | 401 | Llave API ausente o inválida, o discrepancia de entorno (llave de sandbox apuntando a un tenant de producción o viceversa) |
| `FORBIDDEN` | 403 | El emisor de `X-Issuer-Id` pertenece a otro tenant |
| `NOT_FOUND` | 404 | El emisor de `X-Issuer-Id` no existe |
