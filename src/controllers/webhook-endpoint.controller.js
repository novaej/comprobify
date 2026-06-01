const webhookEndpointService = require('../services/webhook-endpoint.service');

/**
 * POST /api/webhooks
 *
 * Register a new webhook endpoint. Returns the endpoint object plus the
 * signing secret — the secret is shown exactly once and not stored in plain
 * text after this response.
 */
async function create(req, res) {
  const { url, eventTypes = [] } = req.body;
  const { endpoint, secret } = await webhookEndpointService.create(
    req.tenant.id,
    req.tenant.subscription_tier,
    url,
    eventTypes,
  );
  res.status(201).json({ ok: true, endpoint, secret });
}

/**
 * GET /api/webhooks
 *
 * List all active webhook endpoints for the tenant (secrets excluded).
 */
async function list(req, res) {
  const endpoints = await webhookEndpointService.list(req.tenant.id);
  res.json({ ok: true, endpoints });
}

/**
 * PATCH /api/webhooks/:id
 *
 * Update a webhook endpoint's URL, event subscriptions, or active flag.
 */
async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { url, eventTypes, active } = req.body;
  const endpoint = await webhookEndpointService.update(req.tenant.id, id, { url, eventTypes, active });
  res.json({ ok: true, endpoint });
}

/**
 * DELETE /api/webhooks/:id
 *
 * Deregister a webhook endpoint (soft-delete). Past deliveries are preserved.
 */
async function deregister(req, res) {
  const id = parseInt(req.params.id, 10);
  await webhookEndpointService.deregister(req.tenant.id, id);
  res.json({ ok: true });
}

module.exports = { create, list, update, deregister };
