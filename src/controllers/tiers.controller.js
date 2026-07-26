const { TIERS, IVA_RATE } = require('../constants/subscription-tiers');
const pricingService = require('../services/pricing.service');

const list = async (req, res) => {
  const tiers = await Promise.all(Object.entries(TIERS).map(async ([name, tier]) => {
    const priceMonthlyUsd = await pricingService.getCurrentPrice(name, 'MONTHLY');
    const priceYearlyUsd = await pricingService.getCurrentPrice(name, 'YEARLY');
    const upcomingMonthly = await pricingService.getUpcoming(name, 'MONTHLY');
    const upcomingYearly = await pricingService.getUpcoming(name, 'YEARLY');
    const ivaMonthly = Math.round(priceMonthlyUsd * IVA_RATE / (1 + IVA_RATE) * 100) / 100;
    const ivaYearly  = Math.round(priceYearlyUsd  * IVA_RATE / (1 + IVA_RATE) * 100) / 100;
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
      priceMonthlyUsdBase:     Math.round((priceMonthlyUsd - ivaMonthly) * 100) / 100,
      priceMonthlyUsdIva:      ivaMonthly,
      priceMonthlyUsd,
      priceYearlyUsdBase:      Math.round((priceYearlyUsd - ivaYearly) * 100) / 100,
      priceYearlyUsdIva:       ivaYearly,
      priceYearlyUsd,
      // Transparency for an upcoming, already-announced price change still
      // inside its notice window — null when nothing is pending. Visible to
      // prospective tenants too, not just existing ones who got the email.
      upcomingPriceMonthlyUsd:      upcomingMonthly ? upcomingMonthly.priceUsd : null,
      monthlyPriceEffectiveAt:      upcomingMonthly ? upcomingMonthly.effectiveAt : null,
      upcomingPriceYearlyUsd:       upcomingYearly ? upcomingYearly.priceUsd : null,
      yearlyPriceEffectiveAt:       upcomingYearly ? upcomingYearly.effectiveAt : null,
      overagePerDocumentUsd:   tier.overagePerDocumentUsd,
    };
  }));
  res.json({ ok: true, ivaRate: IVA_RATE, tiers });
};

module.exports = { list };
