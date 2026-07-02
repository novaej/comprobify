const { TIERS, IVA_RATE } = require('../constants/subscription-tiers');

const list = (req, res) => {
  const tiers = Object.entries(TIERS).map(([name, tier]) => {
    const ivaMonthly = Math.round(tier.priceMonthlyUsd * IVA_RATE / (1 + IVA_RATE) * 100) / 100;
    const ivaYearly  = Math.round(tier.priceYearlyUsd  * IVA_RATE / (1 + IVA_RATE) * 100) / 100;
    return {
      name,
      documentQuota:           tier.documentQuota,
      maxBranches:             tier.maxBranches,
      maxIssuePointsPerBranch: tier.maxIssuePointsPerBranch,
      maxWebhookEndpoints:     tier.maxWebhookEndpoints,
      writeRateLimit:          tier.writeRateLimit,
      readRateLimit:           tier.readRateLimit,
      allowedDocumentTypes:    tier.allowedDocumentTypes,
      ivaRate:                 IVA_RATE,
      priceMonthlyUsdBase:     Math.round((tier.priceMonthlyUsd - ivaMonthly) * 100) / 100,
      priceMonthlyUsdIva:      ivaMonthly,
      priceMonthlyUsd:         tier.priceMonthlyUsd,
      priceYearlyUsdBase:      Math.round((tier.priceYearlyUsd - ivaYearly) * 100) / 100,
      priceYearlyUsdIva:       ivaYearly,
      priceYearlyUsd:          tier.priceYearlyUsd,
      overagePerDocumentUsd:   tier.overagePerDocumentUsd,
    };
  });
  res.json({ ok: true, ivaRate: IVA_RATE, tiers });
};

module.exports = { list };
