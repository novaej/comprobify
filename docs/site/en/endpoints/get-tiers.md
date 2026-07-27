# Get Tiers

Returns the full subscription tier catalog — quota, pricing (IVA-inclusive), document types, and limits for every tier including FREE.

```
GET /v1/tiers
```

## Authentication

None. This is a public, unauthenticated endpoint with no rate limit — it's static catalog data, suitable for a pricing page.

## Response

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
      "upcomingPriceMonthlyUsd": null,
      "monthlyPriceEffectiveAt": null,
      "upcomingPriceYearlyUsd": null,
      "yearlyPriceEffectiveAt": null,
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
      "upcomingPriceMonthlyUsd": 25,
      "monthlyPriceEffectiveAt": "2026-08-24T00:00:00.000Z",
      "upcomingPriceYearlyUsd": null,
      "yearlyPriceEffectiveAt": null,
      "overagePerDocumentUsd": 0.30
    }
  ]
}
```

All prices are in USD. `priceMonthlyUsd` and `priceYearlyUsd` are IVA-inclusive all-in amounts — the exact figure a tenant transfers via SPI. `priceMonthlyUsdBase` is the taxable base (base imponible on the SRI invoice); `priceMonthlyUsdIva` is the 15% IVA portion. `ivaRate` is exposed both at the top level and per tier so a pricing page can show the breakdown without hardcoding the tax rate.

`priceYearlyUsd` is the discounted annual price (2 months free vs. paying monthly). `maxBranches`/`maxIssuePointsPerBranch` are `null` for BUSINESS, meaning unlimited. `overagePerDocumentUsd` is `null` for FREE — overage billing isn't enforced anywhere yet (no payment gateway exists), these numbers are reference only.

`upcomingPriceMonthlyUsd`/`monthlyPriceEffectiveAt` and `upcomingPriceYearlyUsd`/`yearlyPriceEffectiveAt` reflect a price change an admin has already published but that hasn't taken effect yet (always at least 30 days' notice, per the Terms of Service) — `null` when nothing is pending for that tier/interval. A renewal whose current period ends before `monthlyPriceEffectiveAt`/`yearlyPriceEffectiveAt` is still billed at the current price (`priceMonthlyUsd`/`priceYearlyUsd`), not the new one.

To actually start a subscription for a tier, see [Promote Tenant to Production](promote-tenant.md) (self-service) or have your provider use the admin API.
