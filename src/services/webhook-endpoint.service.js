/**
 * Webhook endpoint service.
 *
 * Manages tenant-registered webhook endpoints: create, list, update, deregister.
 * Enforces tier-based limits on the number of active endpoints per tenant.
 */
const crypto = require('crypto');
const webhookEndpointModel = require('../models/webhook-endpoint.model');
const tenantModel = require('../models/tenant.model');
const AppError = require('../errors/app-error');
const NotFoundError = require('../errors/not-found-error');
const { TIERS, effectiveWebhookEndpointLimit } = require('../constants/subscription-tiers');
const ErrorCodes = require('../constants/error-codes');
const TenantStatus = require('../constants/tenant-status');

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
    isReserved: row.is_reserved === true,
  };
}

/**
 * A webhook endpoint receives the tenant's event fan-out (buyer names, totals),
 * so registering or retargeting one requires a verified email — same gate as
 * branches and keys. After account recovery a tenant is demoted to
 * PENDING_VERIFICATION precisely because possession of the P12 doesn't prove
 * control of the inbox. Disabling an endpoint stays allowed.
 */
async function assertEmailVerified(tenantId) {
  const tenant = await tenantModel.findById(tenantId);
  if (!tenant) throw new NotFoundError('Tenant');
  if (tenant.status !== TenantStatus.ACTIVE) {
    throw new AppError(
      'Email verification is required before registering or changing webhook endpoints. Check your inbox.',
      403,
      ErrorCodes.EMAIL_VERIFICATION_REQUIRED
    );
  }
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
  await assertEmailVerified(tenantId);

  const tier = TIERS[subscriptionTier];
  if (!tier) throw new AppError('Unknown subscription tier', 400);

  const maxEndpoints = effectiveWebhookEndpointLimit(tier);
  const currentCount = await webhookEndpointModel.countActiveByTenantId(tenantId);
  if (currentCount >= maxEndpoints) {
    throw new AppError(
      `Your plan allows a maximum of ${maxEndpoints} webhook endpoint(s). ` +
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
 * List all active, non-reserved webhook endpoints for a tenant (secrets excluded).
 *
 * @param {number} tenantId
 * @param {string} subscriptionTier
 */
async function list(tenantId, subscriptionTier) {
  const rows = await webhookEndpointModel.findActiveByTenantId(tenantId);
  const tier = TIERS[subscriptionTier] || TIERS.FREE;
  return {
    endpoints: rows.map(formatEndpoint),
    limit: { max: effectiveWebhookEndpointLimit(tier), used: rows.length },
  };
}

/**
 * Update an endpoint's URL, event subscriptions, or active flag.
 * A reserved endpoint allows toggling `active` only — `active` isn't a credential, but `url`/`eventTypes` stay locked.
 *
 * @param {number}   tenantId
 * @param {number}   endpointId
 * @param {{ url?: string, eventTypes?: string[], active?: boolean }} fields
 */
async function update(tenantId, endpointId, fields) {
  const existing = await webhookEndpointModel.findByIdAndTenantId(endpointId, tenantId);
  if (!existing) throw new NotFoundError('Webhook endpoint');
  // The controller always passes { url, eventTypes, active } with `undefined` for
  // whatever the caller omitted, so only fields actually supplied count as changes.
  const changed = Object.keys(fields).filter((key) => fields[key] !== undefined);
  if (existing.is_reserved && changed.some((key) => key !== 'active')) {
    throw new NotFoundError('Webhook endpoint');
  }

  // Only retargeting (url/eventTypes) is gated; toggling `active` never is.
  if (changed.includes('url') || changed.includes('eventTypes')) {
    await assertEmailVerified(tenantId);
  }

  const updated = await webhookEndpointModel.update(endpointId, fields);
  return formatEndpoint(updated);
}

/**
 * Deregister an endpoint (soft-delete via active=false). Allowed on a reserved endpoint too.
 *
 * @param {number} tenantId
 * @param {number} endpointId
 */
async function deregister(tenantId, endpointId) {
  const existing = await webhookEndpointModel.findByIdAndTenantId(endpointId, tenantId);
  if (!existing) throw new NotFoundError('Webhook endpoint');

  await webhookEndpointModel.update(endpointId, { active: false });
}

module.exports = { create, list, update, deregister, formatEndpoint };
