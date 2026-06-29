const TIERS = require('../constants/subscription-tiers');

const list = (req, res) => {
  const tiers = Object.entries(TIERS).map(([name, tier]) => ({
    name,
    documentQuota: tier.documentQuota,
    maxBranches: tier.maxBranches,
    maxIssuePointsPerBranch: tier.maxIssuePointsPerBranch,
    maxWebhookEndpoints: tier.maxWebhookEndpoints,
    writeRateLimit: tier.writeRateLimit,
    readRateLimit: tier.readRateLimit,
    allowedDocumentTypes: tier.allowedDocumentTypes,
    priceMonthlyUsd: tier.priceMonthlyUsd,
    priceYearlyUsd: tier.priceYearlyUsd,
    overagePerDocumentUsd: tier.overagePerDocumentUsd,
  }));
  res.json({ ok: true, tiers });
};

module.exports = { list };
