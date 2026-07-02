jest.mock('../../../src/models/notification.model');
jest.mock('../../../src/models/notification-preference.model');
jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/services/webhook-delivery.service');

const notificationModel = require('../../../src/models/notification.model');
const notificationPreferenceModel = require('../../../src/models/notification-preference.model');
const webhookDeliveryService = require('../../../src/services/webhook-delivery.service');
const notificationService = require('../../../src/services/notification.service');

describe('NotificationService', () => {
  beforeEach(() => {
    webhookDeliveryService.fanOut.mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createPaymentReviewed', () => {
    test('returns null and creates nothing when the tenant disabled this type', async () => {
      notificationPreferenceModel.isEnabled.mockResolvedValue(false);

      const result = await notificationService.createPaymentReviewed(
        { id: 20, purpose: 'INITIAL' }, { id: 10, tenant_id: 1, tier: 'STARTER' }, 'VERIFIED',
      );

      expect(result).toBeNull();
      expect(notificationModel.create).not.toHaveBeenCalled();
    });

    test('creates an INFO PAYMENT_VERIFIED notification and fans it out', async () => {
      notificationPreferenceModel.isEnabled.mockResolvedValue(true);
      notificationModel.create.mockResolvedValue({ id: 100, type: 'PAYMENT_VERIFIED' });

      const result = await notificationService.createPaymentReviewed(
        { id: 20, purpose: 'INITIAL', amount: 17.39, total_amount: 20 },
        { id: 10, tenant_id: 1, tier: 'STARTER', billing_interval: 'MONTHLY' },
        'VERIFIED',
      );

      expect(notificationModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 1,
        type: 'PAYMENT_VERIFIED',
        severity: 'INFO',
        metadata: expect.objectContaining({
          paymentId: 20, subscriptionId: 10, tier: 'STARTER', billingInterval: 'MONTHLY',
          purpose: 'INITIAL', amount: 20, rejectionReasonCode: null,
        }),
      }));
      expect(webhookDeliveryService.fanOut).toHaveBeenCalledWith({ id: 100, type: 'PAYMENT_VERIFIED' });
      expect(result).toEqual({ id: 100, type: 'PAYMENT_VERIFIED' });
    });

    test('creates a WARNING PAYMENT_REJECTED notification including the rejection reason', async () => {
      notificationPreferenceModel.isEnabled.mockResolvedValue(true);
      notificationModel.create.mockResolvedValue({ id: 101, type: 'PAYMENT_REJECTED' });

      await notificationService.createPaymentReviewed(
        { id: 20, purpose: 'RENEWAL', amount: 16.52, total_amount: 19, rejection_reason_code: 'TRANSFER_NOT_FOUND' },
        { id: 10, tenant_id: 1, tier: 'STARTER', billing_interval: 'MONTHLY' },
        'REJECTED',
      );

      expect(notificationModel.create).toHaveBeenCalledWith(expect.objectContaining({
        type: 'PAYMENT_REJECTED',
        severity: 'WARNING',
        message: expect.stringContaining('no matching transfer was found in the account'),
        metadata: expect.objectContaining({ amount: 19, rejectionReasonCode: 'TRANSFER_NOT_FOUND' }),
      }));
    });

    test('uses the payment target_tier/target_billing_interval for a TIER_CHANGE payment, not the subscription\'s current values', async () => {
      notificationPreferenceModel.isEnabled.mockResolvedValue(true);
      notificationModel.create.mockResolvedValue({ id: 102, type: 'PAYMENT_VERIFIED' });

      await notificationService.createPaymentReviewed(
        {
          id: 20, purpose: 'TIER_CHANGE', amount: 782.61, total_amount: 900,
          target_tier: 'GROWTH', target_billing_interval: 'YEARLY',
        },
        { id: 10, tenant_id: 1, tier: 'STARTER', billing_interval: 'MONTHLY' },
        'VERIFIED',
      );

      expect(notificationModel.create).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('GROWTH'),
        metadata: expect.objectContaining({ tier: 'GROWTH', billingInterval: 'YEARLY', amount: 900 }),
      }));
    });
  });

  describe('createSubscriptionRenewalDue', () => {
    test('returns null when the tenant disabled this type', async () => {
      notificationPreferenceModel.isEnabled.mockResolvedValue(false);

      const result = await notificationService.createSubscriptionRenewalDue(
        { id: 10, tenant_id: 1, tier: 'GROWTH', current_period_end: new Date() },
        { id: 40, amount: 79 },
      );

      expect(result).toBeNull();
      expect(notificationModel.create).not.toHaveBeenCalled();
    });

    test('creates a WARNING SUBSCRIPTION_RENEWAL_DUE notification and fans it out', async () => {
      notificationPreferenceModel.isEnabled.mockResolvedValue(true);
      notificationModel.create.mockResolvedValue({ id: 102, type: 'SUBSCRIPTION_RENEWAL_DUE' });
      const periodEnd = new Date('2026-07-06T00:00:00Z');

      const result = await notificationService.createSubscriptionRenewalDue(
        { id: 10, tenant_id: 1, tier: 'GROWTH', current_period_end: periodEnd },
        { id: 40, amount: 79 },
      );

      expect(notificationModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 1,
        type: 'SUBSCRIPTION_RENEWAL_DUE',
        severity: 'WARNING',
        metadata: expect.objectContaining({ subscriptionId: 10, paymentId: 40, tier: 'GROWTH', amount: 79, currentPeriodEnd: periodEnd }),
      }));
      expect(webhookDeliveryService.fanOut).toHaveBeenCalledWith({ id: 102, type: 'SUBSCRIPTION_RENEWAL_DUE' });
      expect(result).toEqual({ id: 102, type: 'SUBSCRIPTION_RENEWAL_DUE' });
    });
  });

  describe('createSubscriptionExpired', () => {
    test('returns null when the tenant disabled this type', async () => {
      notificationPreferenceModel.isEnabled.mockResolvedValue(false);

      const result = await notificationService.createSubscriptionExpired({ id: 10, tenant_id: 1, tier: 'GROWTH' });

      expect(result).toBeNull();
      expect(notificationModel.create).not.toHaveBeenCalled();
    });

    test('creates an ERROR SUBSCRIPTION_EXPIRED notification and fans it out', async () => {
      notificationPreferenceModel.isEnabled.mockResolvedValue(true);
      notificationModel.create.mockResolvedValue({ id: 103, type: 'SUBSCRIPTION_EXPIRED' });

      const result = await notificationService.createSubscriptionExpired({ id: 10, tenant_id: 1, tier: 'GROWTH' });

      expect(notificationModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 1,
        type: 'SUBSCRIPTION_EXPIRED',
        severity: 'ERROR',
        metadata: { subscriptionId: 10, previousTier: 'GROWTH' },
      }));
      expect(webhookDeliveryService.fanOut).toHaveBeenCalledWith({ id: 103, type: 'SUBSCRIPTION_EXPIRED' });
      expect(result).toEqual({ id: 103, type: 'SUBSCRIPTION_EXPIRED' });
    });
  });
});
