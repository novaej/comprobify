const TIERS = {
  FREE: {
    invoiceQuota:   100,
    maxIssuers:     1,
    writeRateLimit: 10,
    readRateLimit:  60,
  },
  STARTER: {
    invoiceQuota:   1000,
    maxIssuers:     2,
    writeRateLimit: 60,
    readRateLimit:  300,
  },
  GROWTH: {
    invoiceQuota:   5000,
    maxIssuers:     5,
    writeRateLimit: 120,
    readRateLimit:  600,
  },
  BUSINESS: {
    invoiceQuota:   20000,
    maxIssuers:     null,
    writeRateLimit: 300,
    readRateLimit:  1500,
  },
};

module.exports = TIERS;
