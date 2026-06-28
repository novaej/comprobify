// allowedDocumentTypes gates which document types a tenant can activate via
// addDocumentType / createBranch (src/services/issuer.service.js). Only '01' and
// '04' are implemented today (see SUPPORTED_TYPES in src/builders/index.js) — update
// these lists (not just the commented full distribution below) as each new builder
// in NEXT_STEPS.md #1 ships, or new types will be silently unreachable on Growth/Business.
const TIERS = {
  FREE: {
    documentQuota:           5,
    maxBranches:             1,
    maxIssuePointsPerBranch: 1,
    maxWebhookEndpoints:     1,
    writeRateLimit:          10,
    readRateLimit:           60,
    allowedDocumentTypes:    ['01'],
  },
  STARTER: {
    documentQuota:           1000,
    maxBranches:             3,
    maxIssuePointsPerBranch: 2,
    maxWebhookEndpoints:     2,
    writeRateLimit:          60,
    readRateLimit:           300,
    allowedDocumentTypes:    ['01'],
  },
  GROWTH: {
    documentQuota:           5000,
    maxBranches:             10,
    maxIssuePointsPerBranch: 5,
    maxWebhookEndpoints:     5,
    writeRateLimit:          120,
    readRateLimit:           600,
    allowedDocumentTypes:    ['01', '04'],
  },
  BUSINESS: {
    documentQuota:           20000,
    maxBranches:             null,
    maxIssuePointsPerBranch: null,
    maxWebhookEndpoints:     10,
    writeRateLimit:          300,
    readRateLimit:           1500,
    allowedDocumentTypes:    ['01', '04'],
  },
};

// Indicative full distribution once all SRI document types have builders
// (NEXT_STEPS.md #1: 07 retención, 05 nota de débito, 03 liquidación, 06 guía de
// remisión). Not live — copy individual entries into the tiers above as each
// type ships, per STRATEGY.md's "Growth+: credit notes, retenciones, other types".
//
// FREE:     allowedDocumentTypes: ['01'],
// STARTER:  allowedDocumentTypes: ['01'],
// GROWTH:   allowedDocumentTypes: ['01', '04', '07'],
// BUSINESS: allowedDocumentTypes: ['01', '03', '04', '05', '06', '07'],

module.exports = TIERS;
