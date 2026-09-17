const { TIERS, IVA_RATE } = require('../constants/subscription-tiers');
const { TIER_LIMIT_SCOPE } = require('../constants/tier-limit-scope');
const pricingService = require('../services/pricing.service');

const list = async (req, res) => {
  // Extra-seat add-on (ADR-032) — a single flat price, not per-tier, so it's
  // resolved once and returned as a top-level field alongside `tiers` rather
  // than repeated on every tier row.
  const [seatMonthly, seatYearly, upcomingSeatMonthly, upcomingSeatYearly] = await Promise.all([
    pricingService.getCurrentSeatPrice('MONTHLY'),
    pricingService.getCurrentSeatPrice('YEARLY'),
    pricingService.getUpcomingSeatPrice('MONTHLY'),
    pricingService.getUpcomingSeatPrice('YEARLY'),
  ]);
  const seatIvaMonthly = Math.round(seatMonthly * IVA_RATE * 100) / 100;
  const seatIvaYearly = Math.round(seatYearly * IVA_RATE * 100) / 100;
  const extraSeat = {
    priceMonthlyUsd: seatMonthly,
    priceMonthlyUsdIva: seatIvaMonthly,
    priceMonthlyUsdTotal: Math.round((seatMonthly + seatIvaMonthly) * 100) / 100,
    priceYearlyUsd: seatYearly,
    priceYearlyUsdIva: seatIvaYearly,
    priceYearlyUsdTotal: Math.round((seatYearly + seatIvaYearly) * 100) / 100,
    upcomingPriceMonthlyUsd: upcomingSeatMonthly ? upcomingSeatMonthly.priceUsd : null,
    monthlyPriceEffectiveAt: upcomingSeatMonthly ? upcomingSeatMonthly.effectiveAt : null,
    upcomingPriceYearlyUsd: upcomingSeatYearly ? upcomingSeatYearly.priceUsd : null,
    yearlyPriceEffectiveAt: upcomingSeatYearly ? upcomingSeatYearly.effectiveAt : null,
  };

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
      maxApiKeys:              tier.maxApiKeys,
      maxUsers:                tier.maxUsers,
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
  // maxApiKeys/maxWebhookEndpoints above are each tier's exact self-service
  // ceiling now — comprobify-web's own internal keys/webhook no longer add
  // reserved headroom on top (migration 102), so there's nothing left to
  // publish here; a tenant's limit.max on GET /v1/keys already equals these
  // values exactly.
  res.json({
    ok: true,
    ivaRate: IVA_RATE,
    limitScopes: TIER_LIMIT_SCOPE,
    tiers,
    extraSeat,
  });
};

module.exports = { list };
