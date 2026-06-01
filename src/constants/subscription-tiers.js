const TIERS = {
  FREE: {
    documentQuota:           100,
    maxBranches:             1,
    maxIssuePointsPerBranch: 1,
    maxWebhookEndpoints:     1,
    writeRateLimit:          10,
    readRateLimit:           60,
  },
  STARTER: {
    documentQuota:           1000,
    maxBranches:             3,
    maxIssuePointsPerBranch: 2,
    maxWebhookEndpoints:     2,
    writeRateLimit:          60,
    readRateLimit:           300,
  },
  GROWTH: {
    documentQuota:           5000,
    maxBranches:             10,
    maxIssuePointsPerBranch: 5,
    maxWebhookEndpoints:     5,
    writeRateLimit:          120,
    readRateLimit:           600,
  },
  BUSINESS: {
    documentQuota:           20000,
    maxBranches:             null,
    maxIssuePointsPerBranch: null,
    maxWebhookEndpoints:     10,
    writeRateLimit:          300,
    readRateLimit:           1500,
  },
};

module.exports = TIERS;
