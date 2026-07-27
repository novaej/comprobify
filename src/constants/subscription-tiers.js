// allowedDocumentTypes gates which document types a tenant can activate via
// addDocumentType / createBranch (src/services/issuer.service.js). Only '01' and
// '04' are implemented today (see SUPPORTED_TYPES in src/builders/index.js) — update
// these lists (not just the commented full distribution below) as each new builder
// in NEXT_STEPS.md's "Additional Document Types" item ships, or new types will be
// silently unreachable on Growth/Business.
//
// priceMonthlyUsd/priceYearlyUsd used to live here as plain numbers — they
// moved to the tier_prices table (migration 076) so a price change can be
// historical (a renewal due before a new price's effective_at still bills
// the old one) with a 30-day notice, per docs/agreements/terms-of-service.md.
// See src/services/pricing.service.js (getCurrentPrice/getPriceAsOf) for the
// resolver — nothing in this file's TIERS object carries a price anymore.
// overagePerDocumentUsd stays here (not yet enforced — no payment gateway,
// see NEXT_STEPS.md's "Payment Gateway Integration" item) since overage
// billing hasn't been built and so has no history/notice requirement yet.

const config = require('../config');

// Sourced from config (IVA_RATE env var, defaults to the current 15% rate) —
// re-exported here under its existing name so every consumer that already
// does `const { TIERS, IVA_RATE } = require('.../subscription-tiers')`
// keeps working unchanged. See src/config/index.js for why this is
// env-driven rather than a hardcoded literal. Deliberately NOT part of the
// tier_prices history/notice mechanism — it's a government-mandated tax
// rate, not a Comprobify pricing decision, and every payment already
// snapshots the rate in effect at creation (payments.iva_rate) for audit
// purposes.
const IVA_RATE = config.ivaRate;

const TIERS = {
  FREE: {
    documentQuota:           5,
    maxBranches:             1,
    maxIssuePointsPerBranch: 1,
    maxWebhookEndpoints:     1,
    writeRateLimit:          10,
    readRateLimit:           60,
    allowedDocumentTypes:    ['01'],
    overagePerDocumentUsd:   null,
  },
  STARTER: {
    documentQuota:           200,
    maxBranches:             3,
    maxIssuePointsPerBranch: 2,
    maxWebhookEndpoints:     2,
    writeRateLimit:          60,
    readRateLimit:           300,
    allowedDocumentTypes:    ['01'],
    overagePerDocumentUsd:   0.30,
  },
  GROWTH: {
    documentQuota:           1000,
    maxBranches:             10,
    maxIssuePointsPerBranch: 5,
    maxWebhookEndpoints:     5,
    writeRateLimit:          120,
    readRateLimit:           600,
    allowedDocumentTypes:    ['01', '04'],
    overagePerDocumentUsd:   0.15,
  },
  BUSINESS: {
    documentQuota:           4000,
    maxBranches:             null,
    maxIssuePointsPerBranch: null,
    maxWebhookEndpoints:     10,
    writeRateLimit:          300,
    readRateLimit:           1500,
    allowedDocumentTypes:    ['01', '04'],
    overagePerDocumentUsd:   0.08,
  },
};

// Indicative full distribution once all SRI document types have builders
// (see NEXT_STEPS.md's "Additional Document Types" item: 07 retención, 05 nota de
// débito, 03 liquidación, 06 guía de remisión). Not live — copy individual entries
// into the tiers above as each type ships.
//
// FREE:     allowedDocumentTypes: ['01'],
// STARTER:  allowedDocumentTypes: ['01'],
// GROWTH:   allowedDocumentTypes: ['01', '04', '07'],
// BUSINESS: allowedDocumentTypes: ['01', '03', '04', '05', '06', '07'],

module.exports = { TIERS, IVA_RATE };
