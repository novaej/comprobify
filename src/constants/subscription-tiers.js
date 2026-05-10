const TIERS = {
  FREE: {
    documentQuota:  100,
    maxIssuers:     1,
    writeRateLimit: 10,
    readRateLimit:  60,
  },
  STARTER: {
    documentQuota:  1000,
    maxIssuers:     2,
    writeRateLimit: 60,
    readRateLimit:  300,
  },
  GROWTH: {
    documentQuota:  5000,
    maxIssuers:     5,
    writeRateLimit: 120,
    readRateLimit:  600,
  },
  BUSINESS: {
    documentQuota:  20000,
    maxIssuers:     null,
    writeRateLimit: 300,
    readRateLimit:  1500,
  },
};

module.exports = TIERS;
