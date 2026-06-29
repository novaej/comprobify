# Get Tiers

Returns the full subscription tier catalog — quota, pricing, document types, and limits for every tier including FREE.

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
      "priceMonthlyUsd": 0,
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
      "priceMonthlyUsd": 19,
      "priceYearlyUsd": 190,
      "overagePerDocumentUsd": 0.30
    }
  ]
}
```

`priceYearlyUsd` is the discounted annual price (2 months free vs. paying monthly). `maxBranches`/`maxIssuePointsPerBranch` are `null` for BUSINESS, meaning unlimited. `overagePerDocumentUsd` is `null` for FREE — overage billing isn't enforced anywhere yet (no payment gateway exists), these numbers are reference only.

To actually start a subscription for a tier, see [Promote Tenant to Production](promote-tenant.md) (self-service) or have your provider use the admin API.
