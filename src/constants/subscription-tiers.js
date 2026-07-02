// allowedDocumentTypes gates which document types a tenant can activate via
// addDocumentType / createBranch (src/services/issuer.service.js). Only '01' and
// '04' are implemented today (see SUPPORTED_TYPES in src/builders/index.js) — update
// these lists (not just the commented full distribution below) as each new builder
// in NEXT_STEPS.md #1 ships, or new types will be silently unreachable on Growth/Business.
//
// priceMonthlyUsd / priceYearlyUsd are IVA-inclusive all-in amounts — the exact
// figure a tenant transfers via SPI and what appears as the invoice total. The
// taxable base (base imponible) is derived at payment-creation time as
// total / (1 + IVA_RATE), stored in payments.amount alongside payments.iva_amount
// and payments.total_amount for a full per-payment audit trail.
//
// priceYearlyUsd = priceMonthlyUsd × 10 (2 months free — standard SaaS yearly
// discount). overagePerDocumentUsd is not enforced yet (no payment gateway —
// NEXT_STEPS.md #9).

const IVA_RATE = 0.15;

const TIERS = {
  FREE: {
    documentQuota:           5,
    maxBranches:             1,
    maxIssuePointsPerBranch: 1,
    maxWebhookEndpoints:     1,
    writeRateLimit:          10,
    readRateLimit:           60,
    allowedDocumentTypes:    ['01'],
    priceMonthlyUsd:         0,
    priceYearlyUsd:          0,
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
    priceMonthlyUsd:         20,
    priceYearlyUsd:          200,
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
    priceMonthlyUsd:         90,
    priceYearlyUsd:          900,
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
    priceMonthlyUsd:         230,
    priceYearlyUsd:          2300,
    overagePerDocumentUsd:   0.08,
  },
};

// Indicative full distribution once all SRI document types have builders
// (NEXT_STEPS.md #1: 07 retención, 05 nota de débito, 03 liquidación, 06 guía de
// remisión). Not live — copy individual entries into the tiers above as each
// type ships.
//
// FREE:     allowedDocumentTypes: ['01'],
// STARTER:  allowedDocumentTypes: ['01'],
// GROWTH:   allowedDocumentTypes: ['01', '04', '07'],
// BUSINESS: allowedDocumentTypes: ['01', '03', '04', '05', '06', '07'],

module.exports = { TIERS, IVA_RATE };
