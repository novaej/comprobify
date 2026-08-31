const { TIERS, IVA_RATE } = require('../constants/subscription-tiers');
const pricingService = require('../services/pricing.service');

const list = async (req, res) => {
  const tiers = await Promise.all(Object.entries(TIERS).map(async ([name, tier]) => {
    // tier_prices.price_usd is the advertised, tax-EXCLUSIVE sticker price —
    // matches how every local competitor publishes prices (IVA added at
    // checkout, never baked into the listed number). priceMonthlyUsd stays
    // the headline field for backward compatibility; *Total is what a tenant
    // actually pays. See subscription.service.js's breakdownAmount, which
    // applies the same base -> total direction when a real payment is cut.
    // Some tiers don't sell MONTHLY at all (SOLO is yearly-only — see
    // subscription-tiers.js's billingIntervals). Skip resolving a price for
    // an interval the tier doesn't offer rather than advertising a number
    // nobody can actually subscribe at.
    const billingIntervals = tier.billingIntervals || ['MONTHLY', 'YEARLY'];
    const sellsMonthly = billingIntervals.includes('MONTHLY');
    const sellsYearly = billingIntervals.includes('YEARLY');

    const priceMonthlyUsd = sellsMonthly ? await pricingService.getCurrentPrice(name, 'MONTHLY') : null;
    const priceYearlyUsd = sellsYearly ? await pricingService.getCurrentPrice(name, 'YEARLY') : null;
    const upcomingMonthly = sellsMonthly ? await pricingService.getUpcoming(name, 'MONTHLY') : null;
    const upcomingYearly = sellsYearly ? await pricingService.getUpcoming(name, 'YEARLY') : null;
    const ivaMonthly = priceMonthlyUsd !== null ? Math.round(priceMonthlyUsd * IVA_RATE * 100) / 100 : null;
    const ivaYearly  = priceYearlyUsd !== null ? Math.round(priceYearlyUsd  * IVA_RATE * 100) / 100 : null;
    return {
      name,
      documentQuota:           tier.documentQuota,
      maxBranches:             tier.maxBranches,
      maxIssuePointsPerBranch: tier.maxIssuePointsPerBranch,
      maxWebhookEndpoints:     tier.maxWebhookEndpoints,
      writeRateLimit:          tier.writeRateLimit,
      readRateLimit:           tier.readRateLimit,
      billingIntervals,
      allowedDocumentTypes:    tier.allowedDocumentTypes,
      ivaRate:                 IVA_RATE,
      priceMonthlyUsd,
      priceMonthlyUsdIva:      ivaMonthly,
      priceMonthlyUsdTotal:    priceMonthlyUsd !== null ? Math.round((priceMonthlyUsd + ivaMonthly) * 100) / 100 : null,
      priceYearlyUsd,
      priceYearlyUsdIva:       ivaYearly,
      priceYearlyUsdTotal:     priceYearlyUsd !== null ? Math.round((priceYearlyUsd + ivaYearly) * 100) / 100 : null,
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
