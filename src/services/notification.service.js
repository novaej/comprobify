/**
 * Notification service.
 *
 * Responsible for:
 *  - Creating notifications for event-driven conditions (DOCUMENT_AUTHORIZED,
 *    PAYMENT_VERIFIED/REJECTED, SUBSCRIPTION_RENEWAL_DUE, SUBSCRIPTION_EXPIRED).
 *  - Running per-tenant certificate expiry checks (called by the scheduler service).
 *  - Reading and marking notifications for the tenant.
 *  - Managing per-tenant notification preferences (opt-out per type).
 *
 * Delivery model:
 *   Every time a notification row is created or updated, the webhook-delivery
 *   service fans the event out to all active, subscribed webhook endpoints for
 *   the tenant (fire-and-forget). The frontend backend also polls
 *   GET /api/notifications on a schedule and uses ?sinceId= to catch up after
 *   downtime. There is no server-push mechanism.
 *
 * Aggregation window (DOCUMENT_AUTHORIZED):
 *   Multiple authorisations within AGGREGATION_WINDOW_SECONDS are merged into a
 *   single notification row (count + document list in metadata). This prevents
 *   flooding the notification list during batch processing. The same notification
 *   ID may have an updated count on successive polls within the window — the
 *   frontend should upsert by ID rather than append.
 *
 * Cert expiry thresholds:
 *   > 30 days  — auto-dismiss any existing cert alert (cert was renewed)
 *   8–30 days  — CERT_EXPIRING / WARNING
 *   1–7 days   — CERT_EXPIRING / ERROR
 *   ≤ 0 days   — CERT_EXPIRED  / ERROR
 *
 * Periodic checks:
 *   Certificate expiry and webhook retries are handled by the notification
 *   scheduler (POST /api/admin/jobs/notifications), which calls
 *   runCertChecksForTenant() for every non-suspended tenant. No sync endpoint
 *   is exposed to tenants — scheduling is API-owned.
 */
const moment = require('moment');
const notificationModel = require('../models/notification.model');
const notificationPreferenceModel = require('../models/notification-preference.model');
const issuerModel = require('../models/issuer.model');
const NotificationTypes = require('../constants/notification-types');
const NotificationSeverity = require('../constants/notification-severity');
const NotificationChannel = require('../constants/notification-channel');
const { NOTIFICATION_CATALOG, isMandatory } = require('../constants/notification-catalog');
const pendingEffectService = require('./pending-effect.service');
const { EffectTypes } = require('../constants/effect-types');

const PAYMENT_PURPOSE_LABELS = { INITIAL: 'subscription', TIER_CHANGE: 'tier change', RENEWAL: 'renewal' };
const REJECTION_REASON_LABELS = {
  AMOUNT_MISMATCH: 'the transferred amount did not match what was requested',
  TRANSFER_NOT_FOUND: 'no matching transfer was found in the account',
  WRONG_ACCOUNT: 'the transfer was sent to the wrong account',
  ILLEGIBLE_PROOF: 'the uploaded proof was illegible or corrupted',
  DUPLICATE_SUBMISSION: 'this proof was already submitted and reviewed for another payment',
  OTHER: 'see proof for details',
};

/**
 * Every (type, channel) pair a tenant can actually subscribe to — derived
 * from the catalog, used to populate the preferences list. Excludes
 * "mandatory" types (a tenant can't opt out of those on any channel, so they
 * never appear in GET/PATCH /v1/notifications/preferences) and, per type,
 * only includes the channels its catalog entry actually supports.
 */
const SUBSCRIBABLE_TYPE_CHANNELS = Object.entries(NOTIFICATION_CATALOG)
  .filter(([type]) => !isMandatory(type))
  .flatMap(([type, capabilities]) => {
    const channels = [];
    if (capabilities.supportsInApp) channels.push(NotificationChannel.IN_APP);
    if (capabilities.supportsEmail) channels.push(NotificationChannel.EMAIL);
    return channels.map((channel) => ({ type, channel }));
  });

/** Authorisations within this window are merged into one notification row. */
const AGGREGATION_WINDOW_SECONDS = 60;

/** Maximum document entries kept in aggregated notification metadata. */
const AGGREGATION_MAX_DOCS = 50;

const CERT_WARN_DAYS  = 30;
const CERT_ERROR_DAYS = 7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSequential(document) {
  return [
    String(document.branch_code).padStart(3, '0'),
    String(document.issue_point_code).padStart(3, '0'),
    String(document.sequential).padStart(9, '0'),
  ].join('-');
}

/**
 * Durably enqueue a WEBHOOK_FANOUT effect for a notification (ADR-022) —
 * replaces the old direct, unawaited webhookDeliveryService.fanOut() call.
 * The actual fan-out runs in the effect handler (src/effects/index.js),
 * which also breaks the circular dependency this used to need a lazy
 * require for (webhook-delivery-service → notification-model → here).
 *
 * Awaited by callers so the enqueue (durable insert) lands before the
 * caller returns — dispatch (the RabbitMQ publish) stays best-effort.
 */
async function fireWebhookFanOut(notification) {
  const effect = await pendingEffectService.enqueue(EffectTypes.WEBHOOK_FANOUT, notification.tenant_id, { notificationId: notification.id });
  pendingEffectService.dispatch(effect);
}

// ---------------------------------------------------------------------------
// DOCUMENT_AUTHORIZED
// ---------------------------------------------------------------------------

/**
 * Create or update a DOCUMENT_AUTHORIZED notification (fire-and-forget).
 *
 * Called from document-transmission.service after SRI confirms authorisation.
 * Checks the tenant's preference for this type, then either creates a new row
 * or appends to an existing one within the aggregation window.
 *
 * After creating or updating the notification, fans out to all active webhook
 * endpoints subscribed to DOCUMENT_AUTHORIZED.
 *
 * Never throws — failure is logged and swallowed so it cannot affect the HTTP response.
 *
 * @param {object} document - Full document row (after updateStatus).
 * @param {object} issuer   - Resolved issuer (includes tenant_id).
 */
async function createDocumentAuthorized(document, issuer) {
  const enabled = await notificationPreferenceModel.isEnabled(
    issuer.tenant_id,
    NotificationTypes.DOCUMENT_AUTHORIZED,
    NotificationChannel.IN_APP
  );
  if (!enabled) return;

  const sequential = formatSequential(document);
  const docEntry = {
    accessKey:           document.access_key,
    sequential,
    buyerName:           document.buyer_name,
    buyerId:             document.buyer_id,
    total:               document.total,
    issueDate:           document.issue_date,
    authorizationNumber: document.authorization_number || null,
  };

  const existing = await notificationModel.findPendingDocumentAuthorized(
    issuer.tenant_id,
    issuer.id,
    AGGREGATION_WINDOW_SECONDS
  );

  let notification;
  if (existing) {
    const prevMeta = existing.metadata || { documents: [], count: 0 };
    const documents = Array.isArray(prevMeta.documents) ? prevMeta.documents : [];
    if (documents.length < AGGREGATION_MAX_DOCS) documents.push(docEntry);
    const count = (prevMeta.count || 0) + 1;

    notification = await notificationModel.updateAggregated(existing.id, {
      title:    `${count} invoices authorized`,
      message:  `${count} invoices were authorized by SRI.`,
      metadata: { documents, count },
    });
  } else {
    notification = await notificationModel.create({
      tenantId: issuer.tenant_id,
      issuerId: issuer.id,
      type:     NotificationTypes.DOCUMENT_AUTHORIZED,
      severity: NotificationSeverity.INFO,
      title:    'Invoice authorized',
      message:  `Invoice ${sequential} for ${document.buyer_name} was authorized by SRI.`,
      metadata: { documents: [docEntry], count: 1 },
    });
  }

  if (notification) await fireWebhookFanOut(notification);
}

// ---------------------------------------------------------------------------
// Subscription / payment lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a PAYMENT_VERIFIED or PAYMENT_REJECTED notification (fire-and-forget
 * from the caller's perspective — called awaited here, but never throws).
 *
 * Called from subscriptionService.reviewPayment after the admin's decision is
 * recorded. Covers every payment purpose (INITIAL, TIER_CHANGE, RENEWAL) —
 * the wording adapts via `payment.purpose`, the event itself doesn't differ.
 *
 * @param {object} payment      - DB row from payments table (post-decision)
 * @param {object} subscription - DB row from subscriptions table
 * @param {'VERIFIED'|'REJECTED'} decision
 */
async function createPaymentReviewed(payment, subscription, decision) {
  const type = decision === 'VERIFIED' ? NotificationTypes.PAYMENT_VERIFIED : NotificationTypes.PAYMENT_REJECTED;
  const enabled = await notificationPreferenceModel.isEnabled(subscription.tenant_id, type, NotificationChannel.IN_APP);
  if (!enabled) return null;

  const purposeLabel = PAYMENT_PURPOSE_LABELS[payment.purpose] || PAYMENT_PURPOSE_LABELS.INITIAL;
  // For a TIER_CHANGE payment, the subscription still reflects its CURRENT
  // tier/interval — target_tier/target_billing_interval on the payment carry
  // what's actually being purchased. INITIAL/RENEWAL payments never set
  // target_tier, so this correctly falls back to the subscription's own.
  const tier = payment.target_tier || subscription.tier;
  const billingInterval = payment.target_billing_interval || subscription.billing_interval;

  const notification = await notificationModel.create({
    tenantId: subscription.tenant_id,
    type,
    severity: decision === 'VERIFIED' ? NotificationSeverity.INFO : NotificationSeverity.WARNING,
    title: decision === 'VERIFIED' ? 'Payment verified' : 'Payment rejected',
    message: decision === 'VERIFIED'
      ? `Your ${purposeLabel} payment for the ${tier} plan was verified.`
      : `Your ${purposeLabel} payment for the ${tier} plan was rejected: ${REJECTION_REASON_LABELS[payment.rejection_reason_code] || REJECTION_REASON_LABELS.OTHER}.`,
    metadata: {
      paymentId: payment.id,
      subscriptionId: subscription.id,
      tier,
      billingInterval,
      purpose: payment.purpose,
      amount: payment.total_amount,
      rejectionReasonCode: payment.rejection_reason_code || null,
    },
  });

  if (notification) await fireWebhookFanOut(notification);
  return notification;
}

/**
 * Create a SUBSCRIPTION_RENEWAL_DUE notification when a renewal payment is opened.
 *
 * Called from subscriptionService.processDueRenewals, ahead of current_period_end.
 *
 * @param {object} subscription - DB row from subscriptions table
 * @param {object} payment      - DB row from payments table (purpose RENEWAL)
 */
async function createSubscriptionRenewalDue(subscription, payment) {
  const enabled = await notificationPreferenceModel.isEnabled(subscription.tenant_id, NotificationTypes.SUBSCRIPTION_RENEWAL_DUE, NotificationChannel.IN_APP);
  if (!enabled) return null;

  const dueDate = moment(subscription.current_period_end).format('DD/MM/YYYY');

  const notification = await notificationModel.create({
    tenantId: subscription.tenant_id,
    type: NotificationTypes.SUBSCRIPTION_RENEWAL_DUE,
    severity: NotificationSeverity.WARNING,
    title: 'Subscription renewal due',
    message: `Your ${subscription.tier} subscription renews on ${dueDate}. Submit payment proof to keep your plan active.`,
    metadata: {
      subscriptionId: subscription.id,
      paymentId: payment.id,
      tier: subscription.tier,
      amount: payment.amount,
      currentPeriodEnd: subscription.current_period_end,
    },
  });

  if (notification) await fireWebhookFanOut(notification);
  return notification;
}

/**
 * Create a SUBSCRIPTION_EXPIRED notification when the renewal grace period
 * elapses with no verified renewal payment and the tenant is downgraded to FREE.
 *
 * Called from subscriptionService.processDueRenewals.
 *
 * @param {object} subscription - DB row from subscriptions table (tier = the tier just lost)
 */
async function createSubscriptionExpired(subscription) {
  const enabled = await notificationPreferenceModel.isEnabled(subscription.tenant_id, NotificationTypes.SUBSCRIPTION_EXPIRED, NotificationChannel.IN_APP);
  if (!enabled) return null;

  const notification = await notificationModel.create({
    tenantId: subscription.tenant_id,
    type: NotificationTypes.SUBSCRIPTION_EXPIRED,
    severity: NotificationSeverity.ERROR,
    title: 'Subscription expired',
    message: `Your ${subscription.tier} subscription expired without a renewal payment. You've been moved to the FREE plan.`,
    metadata: { subscriptionId: subscription.id, previousTier: subscription.tier },
  });

  if (notification) await fireWebhookFanOut(notification);
  return notification;
}

/**
 * Create a PRICE_CHANGE_ANNOUNCED notification for one tenant about one
 * published tier_prices row still inside its notice window.
 *
 * Unconditional — PRICE_CHANGE_ANNOUNCED is "mandatory"
 * (notification-catalog.js): a tenant cannot opt out of the
 * 30-day price-change notice, so unlike every other notification type there
 * is no notificationPreferenceModel.isEnabled() gate here. This is also what
 * makes the notifications table a safe idempotency source for this type —
 * see tier-price.model.js's findUnnotifiedPendingForTenant.
 *
 * Called synchronously by pricingService.notifyPendingPriceChangesForTenant
 * — the initial bulk blast at publish time, the reactivation catch-up path
 * (a tenant who was SUSPENDED/PENDING_VERIFICATION when the change
 * published), and the periodic reconciliation sweep all go through the same
 * call.
 *
 * @param {object} tenant - DB row from tenants table
 * @param {object} tierPrice - DB row from tier_prices (PUBLISHED, effective_at in the future)
 * @param {number} previousPriceUsd - the price in effect right now, for the "from -> to" message
 */
async function createPriceChangeAnnounced(tenant, tierPrice, previousPriceUsd) {
  const effectiveDate = moment(tierPrice.effective_at).format('DD/MM/YYYY');
  const newPrice = parseFloat(tierPrice.price_usd);

  const notification = await notificationModel.create({
    tenantId: tenant.id,
    type: NotificationTypes.PRICE_CHANGE_ANNOUNCED,
    severity: NotificationSeverity.INFO,
    title: 'Upcoming price change',
    message: `The ${tierPrice.billing_interval.toLowerCase()} price for ${tierPrice.tier} is changing from $${previousPriceUsd} to $${newPrice} on ${effectiveDate}. Any renewal due before that date is still billed at the current price.`,
    metadata: {
      tierPriceId: tierPrice.id,
      tier: tierPrice.tier,
      billingInterval: tierPrice.billing_interval,
      previousPriceUsd,
      newPriceUsd: newPrice,
      effectiveAt: tierPrice.effective_at,
    },
  });

  if (notification) await fireWebhookFanOut(notification);
  return notification;
}

// ---------------------------------------------------------------------------
// Certificate expiry check
// ---------------------------------------------------------------------------

/**
 * Check certificate expiry for every active issuer belonging to a tenant and
 * upsert CERT_EXPIRING / CERT_EXPIRED alerts accordingly.
 *
 * Called by the notification scheduler (POST /api/admin/jobs/notifications)
 * for every non-suspended tenant. Always checks all issuers regardless of any
 * issuer filter — cert checks are a tenant-wide maintenance operation.
 *
 * @param {number}                                    tenantId
 * @param {Record<string, Record<string, boolean>>}   prefs    - Pre-fetched preferences map (notification-preference.model.js's findByTenantId shape).
 */
async function runCertChecksForTenant(tenantId, prefs) {
  const certExpiringEnabled = prefs[NotificationTypes.CERT_EXPIRING]?.[NotificationChannel.IN_APP] !== false;
  const certExpiredEnabled  = prefs[NotificationTypes.CERT_EXPIRED]?.[NotificationChannel.IN_APP]  !== false;
  if (!certExpiringEnabled && !certExpiredEnabled) return;

  const issuers = await issuerModel.findAllByTenantId(tenantId);
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;

  for (const issuer of issuers) {
    if (!issuer.cert_expiry) continue;

    const daysRemaining = Math.floor((new Date(issuer.cert_expiry) - now) / msPerDay);
    const existingAlert = await notificationModel.findUnreadCertAlertByIssuer(tenantId, issuer.id);

    if (daysRemaining > CERT_WARN_DAYS) {
      if (existingAlert) {
        await notificationModel.markAllCertAlertsAsRead(tenantId, issuer.id);
      }
      continue;
    }

    const alertData = buildCertAlertData(issuer, daysRemaining);
    if (prefs[alertData.type]?.[NotificationChannel.IN_APP] === false) continue;

    let notification;
    if (existingAlert) {
      notification = await notificationModel.update(existingAlert.id, alertData);
    } else {
      notification = await notificationModel.create({ tenantId, issuerId: issuer.id, ...alertData });
    }

    if (notification) await fireWebhookFanOut(notification);
  }
}

function buildCertAlertData(issuer, daysRemaining) {
  const label = `${issuer.business_name} (${issuer.branch_code}-${issuer.issue_point_code})`;

  if (daysRemaining <= 0) {
    return {
      type:     NotificationTypes.CERT_EXPIRED,
      severity: NotificationSeverity.ERROR,
      title:    'Certificate expired',
      message:  `The signing certificate for ${label} has expired. Upload a new P12 immediately to continue issuing documents.`,
      metadata: { issuerId: issuer.id, certExpiry: issuer.cert_expiry, daysRemaining: 0, branchCode: issuer.branch_code, issuePointCode: issuer.issue_point_code },
    };
  }

  const dayWord = daysRemaining === 1 ? 'day' : 'days';
  return {
    type:     NotificationTypes.CERT_EXPIRING,
    severity: daysRemaining <= CERT_ERROR_DAYS ? NotificationSeverity.ERROR : NotificationSeverity.WARNING,
    title:    'Certificate expiring soon',
    message:  `The signing certificate for ${label} expires in ${daysRemaining} ${dayWord}. Upload a new P12 to avoid service interruption.`,
    metadata: { issuerId: issuer.id, certExpiry: issuer.cert_expiry, daysRemaining, branchCode: issuer.branch_code, issuePointCode: issuer.issue_point_code },
  };
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Return all active (unexpired) notifications for a tenant.
 *
 * @param {number}      tenantId
 * @param {number|null} issuerId - When provided, filters to that issuer's
 *   notifications plus any tenant-level ones (issuer_id IS NULL).
 * @param {number|null} sinceId  - When provided, returns only notifications
 *   with id > sinceId (catch-up cursor for consumers recovering from downtime).
 * @returns {Promise<object[]>}
 */
async function listForTenant(tenantId, issuerId = null, sinceId = null) {
  return notificationModel.findActiveByTenantId(tenantId, issuerId, sinceId);
}

/**
 * Mark a notification as read.
 *
 * @param {number} notificationId
 * @param {number} tenantId
 * @returns {Promise<object|null>}
 */
async function markRead(notificationId, tenantId) {
  return notificationModel.markAsRead(notificationId, tenantId);
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * Return the full (type, channel) preference list for a tenant, including
 * defaults (enabled = true) for pairs the tenant has never explicitly set.
 * Mandatory types, and channels a type doesn't support, are never included.
 *
 * @param {number} tenantId
 * @returns {Promise<{ type: string, channel: string, enabled: boolean }[]>}
 */
async function getPreferences(tenantId) {
  const stored = await notificationPreferenceModel.findByTenantId(tenantId);
  return SUBSCRIBABLE_TYPE_CHANNELS.map(({ type, channel }) => ({
    type,
    channel,
    enabled: stored[type]?.[channel] !== undefined ? stored[type][channel] : true,
  }));
}

/**
 * Bulk-upsert notification preferences for a tenant.
 *
 * @param {number} tenantId
 * @param {{ type: string, channel: string, enabled: boolean }[]} updates
 * @returns {Promise<{ type: string, channel: string, enabled: boolean }[]>} Full updated list.
 */
async function updatePreferences(tenantId, updates) {
  await notificationPreferenceModel.upsertMany(tenantId, updates);
  return getPreferences(tenantId);
}

module.exports = {
  createDocumentAuthorized,
  createPaymentReviewed,
  createSubscriptionRenewalDue,
  createSubscriptionExpired,
  createPriceChangeAnnounced,
  runCertChecksForTenant,
  listForTenant,
  markRead,
  getPreferences,
  updatePreferences,
};
