# Consultar Planes

Devuelve el catálogo completo de planes de suscripción — cuota, precios (con IVA incluido), tipos de comprobante y límites para cada plan, incluyendo FREE.

```
GET /v1/tiers
```

## Autenticación

Ninguna. Este es un endpoint público, sin autenticación y sin límite de tasa — es información de catálogo estática, apta para una página de precios.

## Respuesta

**200 OK**

```json
{
  "ok": true,
  "ivaRate": 0.15,
  "tiers": [
    {
      "name": "FREE",
      "documentQuota": 5,
      "maxBranches": 1,
      "maxIssuePointsPerBranch": 1,
      "maxWebhookEndpoints": 1,
      "writeRateLimit": 10,
      "readRateLimit": 60,
      "allowedDocumentTypes": ["01"],
      "ivaRate": 0.15,
      "priceMonthlyUsdBase": 0,
      "priceMonthlyUsdIva": 0,
      "priceMonthlyUsd": 0,
      "priceYearlyUsdBase": 0,
      "priceYearlyUsdIva": 0,
      "priceYearlyUsd": 0,
      "overagePerDocumentUsd": null
    },
    {
      "name": "STARTER",
      "documentQuota": 200,
      "maxBranches": 3,
      "maxIssuePointsPerBranch": 2,
      "maxWebhookEndpoints": 2,
      "writeRateLimit": 60,
      "readRateLimit": 300,
      "allowedDocumentTypes": ["01"],
      "ivaRate": 0.15,
      "priceMonthlyUsdBase": 17.39,
      "priceMonthlyUsdIva": 2.61,
      "priceMonthlyUsd": 20,
      "priceYearlyUsdBase": 173.91,
      "priceYearlyUsdIva": 26.09,
      "priceYearlyUsd": 200,
      "overagePerDocumentUsd": 0.30
    }
  ]
}
```

Todos los precios están en USD. `priceMonthlyUsd` y `priceYearlyUsd` son montos totales con IVA incluido — la cifra exacta que un tenant transfiere vía SPI. `priceMonthlyUsdBase` es la base imponible (base imponible en la factura del SRI); `priceMonthlyUsdIva` es la porción correspondiente al 15% de IVA. `ivaRate` se expone tanto a nivel general como por cada plan, de modo que una página de precios pueda mostrar el desglose sin fijar la tasa de impuesto directamente en el código.

`priceYearlyUsd` es el precio anual con descuento (2 meses gratis frente a pagar mensualmente). `maxBranches`/`maxIssuePointsPerBranch` son `null` para BUSINESS, lo que significa ilimitado. `overagePerDocumentUsd` es `null` para FREE — la facturación por excedente aún no se aplica en ningún lugar (no existe pasarela de pago), estas cifras son solo de referencia.

Para iniciar realmente una suscripción a un plan, consulta [Promover Tenant a Producción](promote-tenant.md) (autoservicio) o solicita a tu proveedor que use la API de administración.
