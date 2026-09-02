// Classifies each TIERS[tier] key by who enforces it: API (comprobify) or
// WEB (comprobify-web only, e.g. dashboard seats — no backing table here).
// GET /v1/tiers returns this as `limitScopes`. See ADR-031.
const LimitScope = Object.freeze({
  API: 'API',
  WEB: 'WEB',
});

const TIER_LIMIT_SCOPE = Object.freeze({
  documentQuota:           LimitScope.API,
  maxBranches:             LimitScope.API,
  maxIssuePointsPerBranch: LimitScope.API,
  maxWebhookEndpoints:     LimitScope.API,
  maxApiKeys:              LimitScope.API,
  writeRateLimit:          LimitScope.API,
  readRateLimit:           LimitScope.API,
  allowedDocumentTypes:    LimitScope.API,
  overagePerDocumentUsd:   LimitScope.API,
  maxUsers:                LimitScope.WEB,
});

module.exports = { LimitScope, TIER_LIMIT_SCOPE };
