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

const PAYMENT_PURPOSE_LABELS = { INITIAL: 'subscription', TIER_CHANGE: 'tier change', RENEWAL: 'renewal' };

/** All defined notification types — used to populate the full preferences list. */
const ALL_TYPES = Object.values(NotificationTypes);

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
 * Fan out a notification to webhook subscribers (fire-and-forget).
 * Import lazily to avoid circular dependency (webhook-delivery-service → notification-model → here).
 */
function fireWebhookFanOut(notification) {
  // Lazy require breaks the circular dependency at runtime
  const webhookDeliveryService = require('./webhook-delivery.service');
  webhookDeliveryService.fanOut(notification)
    .catch(err => console.warn('[notification] Webhook fan-out error:', err.message));
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
    NotificationTypes.DOCUMENT_AUTHORIZED
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

  if (notification) fireWebhookFanOut(notification);
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
  const enabled = await notificationPreferenceModel.isEnabled(subscription.tenant_id, type);
  if (!enabled) return null;

  const purposeLabel = PAYMENT_PURPOSE_LABELS[payment.purpose] || PAYMENT_PURPOSE_LABELS.INITIAL;

  const notification = await notificationModel.create({
    tenantId: subscription.tenant_id,
    type,
    severity: decision === 'VERIFIED' ? NotificationSeverity.INFO : NotificationSeverity.WARNING,
    title: decision === 'VERIFIED' ? 'Payment verified' : 'Payment rejected',
    message: decision === 'VERIFIED'
      ? `Your ${purposeLabel} payment for the ${subscription.tier} plan was verified.`
      : `Your ${purposeLabel} payment for the ${subscription.tier} plan was rejected: ${payment.rejection_reason || 'see proof for details'}.`,
    metadata: {
      paymentId: payment.id,
      subscriptionId: subscription.id,
      tier: subscription.tier,
      purpose: payment.purpose,
      amount: payment.amount,
      rejectionReason: payment.rejection_reason || null,
    },
  });

  if (notification) fireWebhookFanOut(notification);
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
  const enabled = await notificationPreferenceModel.isEnabled(subscription.tenant_id, NotificationTypes.SUBSCRIPTION_RENEWAL_DUE);
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

  if (notification) fireWebhookFanOut(notification);
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
  const enabled = await notificationPreferenceModel.isEnabled(subscription.tenant_id, NotificationTypes.SUBSCRIPTION_EXPIRED);
  if (!enabled) return null;

  const notification = await notificationModel.create({
    tenantId: subscription.tenant_id,
    type: NotificationTypes.SUBSCRIPTION_EXPIRED,
    severity: NotificationSeverity.ERROR,
    title: 'Subscription expired',
    message: `Your ${subscription.tier} subscription expired without a renewal payment. You've been moved to the FREE plan.`,
    metadata: { subscriptionId: subscription.id, previousTier: subscription.tier },
  });

  if (notification) fireWebhookFanOut(notification);
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
 * @param {number}                  tenantId
 * @param {Record<string, boolean>} prefs    - Pre-fetched preferences map.
 */
async function runCertChecksForTenant(tenantId, prefs) {
  const certExpiringEnabled = prefs[NotificationTypes.CERT_EXPIRING] !== false;
  const certExpiredEnabled  = prefs[NotificationTypes.CERT_EXPIRED]  !== false;
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
    if (prefs[alertData.type] === false) continue;

    let notification;
    if (existingAlert) {
      notification = await notificationModel.update(existingAlert.id, alertData);
    } else {
      notification = await notificationModel.create({ tenantId, issuerId: issuer.id, ...alertData });
    }

    if (notification) fireWebhookFanOut(notification);
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
 * Return the full preference list for a tenant, including defaults for types
 * the tenant has never explicitly set.
 *
 * @param {number} tenantId
 * @returns {Promise<{ type: string, enabled: boolean }[]>}
 */
async function getPreferences(tenantId) {
  const stored = await notificationPreferenceModel.findByTenantId(tenantId);
  return ALL_TYPES.map(type => ({
    type,
    enabled: stored[type] !== undefined ? stored[type] : true,
  }));
}

/**
 * Bulk-upsert notification preferences for a tenant.
 *
 * @param {number} tenantId
 * @param {{ type: string, enabled: boolean }[]} updates
 * @returns {Promise<{ type: string, enabled: boolean }[]>} Full updated list.
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
  runCertChecksForTenant,
  listForTenant,
  markRead,
  getPreferences,
  updatePreferences,
};
