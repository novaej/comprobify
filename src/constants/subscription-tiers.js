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
//
// maxApiKeys is enforced here (api-key.service.js); maxUsers has no backing
// table in this API at all — it's comprobify-web's own seat cap, published
// here only so it has one source of truth. See tier-limit-scope.js / ADR-031.

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
    documentQuota:           2,
    maxBranches:             1,
    maxIssuePointsPerBranch: 1,
    maxWebhookEndpoints:     1,
    maxApiKeys:              2,
    maxUsers:                1,
    writeRateLimit:          10,
    readRateLimit:           60,
    // FREE is never purchased, so it has no real billing cadence — display-only.
    billingIntervals:        ['MONTHLY'],
    allowedDocumentTypes:    ['01'],
    overagePerDocumentUsd:   null,
  },
  // SOLO/LITE sit below STARTER to close the entry-price gap against local
  // competitors (Facturex/Azur/Siigo/TuFacturero all publish sub-$40/yr
  // plans — see docs/pricing analysis). Their $/doc is deliberately WORSE
  // than STARTER's, not better — overagePerDocumentUsd/documentQuota ladder
  // downward exactly like STARTER->GROWTH->BUSINESS ladders upward, so the
  // per-unit price only ever improves as a tenant grows, never regresses.
  // Branch/issue-point/webhook caps stay at the FREE ceiling — multi-branch
  // and webhooks remain a STARTER+ upsell, not a volume-tier feature.
  SOLO: {
    documentQuota:           15,
    maxBranches:             1,
    maxIssuePointsPerBranch: 1,
    maxWebhookEndpoints:     1,
    maxApiKeys:              2,
    maxUsers:                1,
    writeRateLimit:          15,
    readRateLimit:           90,
    // Yearly-only — a ~$3.50/mo recurring charge carries payment-processing
    // and support overhead disproportionate to its size; the $35/yr annual
    // commitment is the only way to buy SOLO. See requestTierChange/
    // createSubscription's billingIntervals check.
    billingIntervals:        ['YEARLY'],
    allowedDocumentTypes:    ['01'],
    overagePerDocumentUsd:   0.40,
  },
  LITE: {
    documentQuota:           50,
    maxBranches:             1,
    maxIssuePointsPerBranch: 1,
    maxWebhookEndpoints:     1,
    maxApiKeys:              3,
    maxUsers:                2,
    writeRateLimit:          30,
    readRateLimit:           150,
    billingIntervals:        ['MONTHLY', 'YEARLY'],
    allowedDocumentTypes:    ['01'],
    overagePerDocumentUsd:   0.35,
  },
  STARTER: {
    documentQuota:           200,
    maxBranches:             3,
    maxIssuePointsPerBranch: 2,
    maxWebhookEndpoints:     2,
    maxApiKeys:              5,
    maxUsers:                3,
    writeRateLimit:          60,
    readRateLimit:           300,
    billingIntervals:        ['MONTHLY', 'YEARLY'],
    allowedDocumentTypes:    ['01'],
    overagePerDocumentUsd:   0.30,
  },
  GROWTH: {
    documentQuota:           1000,
    maxBranches:             10,
    maxIssuePointsPerBranch: 5,
    maxWebhookEndpoints:     5,
    maxApiKeys:              10,
    maxUsers:                5,
    writeRateLimit:          120,
    readRateLimit:           600,
    billingIntervals:        ['MONTHLY', 'YEARLY'],
    allowedDocumentTypes:    ['01', '04'],
    overagePerDocumentUsd:   0.15,
  },
  BUSINESS: {
    documentQuota:           4000,
    maxBranches:             null,
    maxIssuePointsPerBranch: null,
    maxWebhookEndpoints:     10,
    maxApiKeys:              20,
    maxUsers:                10,
    writeRateLimit:          300,
    readRateLimit:           1500,
    billingIntervals:        ['MONTHLY', 'YEARLY'],
    allowedDocumentTypes:    ['01', '04'],
    overagePerDocumentUsd:   0.08,
  },
  // documentQuota: null means genuinely unlimited — the same convention
  // maxBranches/maxIssuePointsPerBranch already use above, not the large
  // sentinel this used to be. tenant_quotas.document_quota is nullable as of
  // migration 094 (it was NOT NULL under the old 100000-sentinel design),
  // and both tenantQuotaModel.incrementIfWithinCap's gate and
  // tenantQuotaService.capForTier() treat a null cap as "never block, keep
  // counting document_count for visibility/reporting only".
  // overagePerDocumentUsd is null because there's no cap to ever overage
  // past, not because overage is free.
  ENTERPRISE: {
    documentQuota:           null,
    maxBranches:             null,
    maxIssuePointsPerBranch: null,
    maxWebhookEndpoints:     20,
    maxApiKeys:              null,
    // Unlike everything else on this tier, maxUsers is a real cap, not
    // unlimited — a dashboard seat count still needs a ceiling even at the
    // top tier; extra seats above it are the paid add-on (ADR-032).
    maxUsers:                25,
    writeRateLimit:          600,
    readRateLimit:           3000,
    billingIntervals:        ['MONTHLY', 'YEARLY'],
    allowedDocumentTypes:    ['01', '04'],
    overagePerDocumentUsd:   null,
  },
};

// Indicative full distribution once all SRI document types have builders
// (see NEXT_STEPS.md's "Additional Document Types" item: 07 retención, 05 nota de
// débito, 03 liquidación, 06 guía de remisión). Not live — copy individual entries
// into the tiers above as each type ships.
//
// FREE:       allowedDocumentTypes: ['01'],
// SOLO:       allowedDocumentTypes: ['01'],
// LITE:       allowedDocumentTypes: ['01'],
// STARTER:    allowedDocumentTypes: ['01'],
// GROWTH:     allowedDocumentTypes: ['01', '04', '07'],
// BUSINESS:   allowedDocumentTypes: ['01', '03', '04', '05', '06', '07'],
// ENTERPRISE: allowedDocumentTypes: ['01', '03', '04', '05', '06', '07'],

module.exports = { TIERS, IVA_RATE };
