const subscriptionService = require('../services/subscription.service');

const getMyStatus = async (req, res) => {
  const subscriptions = await subscriptionService.getStatusForTenant(req.tenant.id);
  res.json({ ok: true, subscriptions });
};

const changeTier = async (req, res) => {
  const result = await subscriptionService.requestTierChange(req.tenant.id, req.body.tier);
  res.status(201).json({ ok: true, ...result });
};

module.exports = { getMyStatus, changeTier };
