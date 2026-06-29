const subscriptionService = require('../services/subscription.service');

const getMyStatus = async (req, res) => {
  const subscriptions = await subscriptionService.getStatusForTenant(req.tenant.id);
  res.json({ ok: true, subscriptions });
};

module.exports = { getMyStatus };
