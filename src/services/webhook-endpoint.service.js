/**
 * Webhook endpoint service.
 *
 * Manages tenant-registered webhook endpoints: create, list, update, deregister.
 * Enforces tier-based limits on the number of active endpoints per tenant.
 */
const crypto = require('crypto');
const webhookEndpointModel = require('../models/webhook-endpoint.model');
const AppError = require('../errors/app-error');
const NotFoundError = require('../errors/not-found-error');
const TIERS = require('../constants/subscription-tiers');
const ErrorCodes = require('../constants/error-codes');

/** Generate a 64-char hex secret (32 random bytes). */
function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Format a webhook endpoint row for API responses.
 * The secret is NEVER included — it is returned only at creation time.
 */
function formatEndpoint(row) {
  return {
    id:         row.id,
    url:        row.url,
    eventTypes: row.event_types,
    active:     row.active,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
  };
}

/**
 * Register a new webhook endpoint for a tenant.
 *
 * Returns `{ endpoint, secret }` — the secret is shown exactly once.
 *
 * @param {number}   tenantId
 * @param {string}   subscriptionTier  - e.g. 'FREE', 'STARTER'
 * @param {string}   url
 * @param {string[]} eventTypes        - empty array = all event types
 */
async function create(tenantId, subscriptionTier, url, eventTypes = []) {
  const tier = TIERS[subscriptionTier];
  if (!tier) throw new AppError('Unknown subscription tier', 400);

  const currentCount = await webhookEndpointModel.countActiveByTenantId(tenantId);
  if (currentCount >= tier.maxWebhookEndpoints) {
    throw new AppError(
      `Your plan allows a maximum of ${tier.maxWebhookEndpoints} webhook endpoint(s). ` +
      `Upgrade your plan or deregister an existing endpoint to add a new one.`,
      402,
      ErrorCodes.WEBHOOK_ENDPOINT_LIMIT_REACHED
    );
  }

  const secret   = generateSecret();
  const endpoint = await webhookEndpointModel.create({ tenantId, url, secret, eventTypes });

  return { endpoint: formatEndpoint(endpoint), secret };
}

/**
 * List all active webhook endpoints for a tenant (secrets excluded).
 *
 * @param {number} tenantId
 */
async function list(tenantId) {
  const rows = await webhookEndpointModel.findActiveByTenantId(tenantId);
  return rows.map(formatEndpoint);
}

/**
 * Update an endpoint's URL, event subscriptions, or active flag.
 *
 * @param {number}   tenantId
 * @param {number}   endpointId
 * @param {{ url?: string, eventTypes?: string[], active?: boolean }} fields
 */
async function update(tenantId, endpointId, fields) {
  const existing = await webhookEndpointModel.findByIdAndTenantId(endpointId, tenantId);
  if (!existing) throw new NotFoundError('Webhook endpoint');

  const updated = await webhookEndpointModel.update(endpointId, fields);
  return formatEndpoint(updated);
}

/**
 * Deregister an endpoint (soft-delete via active=false).
 *
 * @param {number} tenantId
 * @param {number} endpointId
 */
async function deregister(tenantId, endpointId) {
  const existing = await webhookEndpointModel.findByIdAndTenantId(endpointId, tenantId);
  if (!existing) throw new NotFoundError('Webhook endpoint');

  await webhookEndpointModel.update(endpointId, { active: false });
}

module.exports = { create, list, update, deregister };
