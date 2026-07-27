jest.mock('../../../src/models/notification.model');
jest.mock('../../../src/models/notification-preference.model');
jest.mock('../../../src/models/issuer.model');
jest.mock('../../../src/services/pending-effect.service');

const notificationModel = require('../../../src/models/notification.model');
const notificationPreferenceModel = require('../../../src/models/notification-preference.model');
const pendingEffectService = require('../../../src/services/pending-effect.service');
const notificationService = require('../../../src/services/notification.service');

describe('NotificationService', () => {
  beforeEach(() => {
    pendingEffectService.enqueue.mockResolvedValue({ id: 'effect-1', effect_type: 'WEBHOOK_FANOUT' });
    pendingEffectService.dispatch.mockResolvedValue();
    notificationModel.updateEmailStatus.mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createPaymentReviewed', () => {
    test('creates an INFO PAYMENT_VERIFIED notification unconditionally, fans it out, and enqueues NOTIFICATION_DISPATCH (email-capable type)', async () => {
      notificationModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000100', tenant_id: '00000000-0000-0000-0000-000000000001', type: 'PAYMENT_VERIFIED' });

      const result = await notificationService.createPaymentReviewed(
        { id: '00000000-0000-0000-0000-000000000020', purpose: 'INITIAL', amount: 17.39, total_amount: 20 },
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', billing_interval: 'MONTHLY' },
        'VERIFIED',
      );

      expect(notificationModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: '00000000-0000-0000-0000-000000000001',
        type: 'PAYMENT_VERIFIED',
        severity: 'INFO',
        metadata: expect.objectContaining({
          paymentId: '00000000-0000-0000-0000-000000000020', subscriptionId: '00000000-0000-0000-0000-000000000010', tier: 'STARTER', billingInterval: 'MONTHLY',
          purpose: 'INITIAL', amount: 20, rejectionReasonCode: null,
        }),
      }));
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith('WEBHOOK_FANOUT', '00000000-0000-0000-0000-000000000001', { notificationId: '00000000-0000-0000-0000-000000000100' }, null, null);
      expect(notificationModel.updateEmailStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000100', 'PENDING');
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith('NOTIFICATION_DISPATCH', '00000000-0000-0000-0000-000000000001', { notificationId: '00000000-0000-0000-0000-000000000100' }, null, 'PAYMENT_VERIFIED');
      expect(result).toEqual({ id: '00000000-0000-0000-0000-000000000100', tenant_id: '00000000-0000-0000-0000-000000000001', type: 'PAYMENT_VERIFIED' });
    });

    test('creates a WARNING PAYMENT_REJECTED notification including the rejection reason', async () => {
      notificationModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000101', tenant_id: '00000000-0000-0000-0000-000000000001', type: 'PAYMENT_REJECTED' });

      await notificationService.createPaymentReviewed(
        { id: '00000000-0000-0000-0000-000000000020', purpose: 'RENEWAL', amount: 16.52, total_amount: 19, rejection_reason_code: 'TRANSFER_NOT_FOUND' },
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', billing_interval: 'MONTHLY' },
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
      notificationModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000102', tenant_id: '00000000-0000-0000-0000-000000000001', type: 'PAYMENT_VERIFIED' });

      await notificationService.createPaymentReviewed(
        {
          id: '00000000-0000-0000-0000-000000000020', purpose: 'TIER_CHANGE', amount: 782.61, total_amount: 900,
          target_tier: 'GROWTH', target_billing_interval: 'YEARLY',
        },
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', billing_interval: 'MONTHLY' },
        'VERIFIED',
      );

      expect(notificationModel.create).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('GROWTH'),
        metadata: expect.objectContaining({ tier: 'GROWTH', billingInterval: 'YEARLY', amount: 900 }),
      }));
    });
  });

  describe('createSubscriptionRenewalDue', () => {
    test('creates a WARNING SUBSCRIPTION_RENEWAL_DUE notification, fans it out, and enqueues NOTIFICATION_DISPATCH', async () => {
      notificationModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000102', tenant_id: '00000000-0000-0000-0000-000000000001', type: 'SUBSCRIPTION_RENEWAL_DUE' });
      const periodEnd = new Date('2026-07-06T00:00:00Z');

      const result = await notificationService.createSubscriptionRenewalDue(
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'GROWTH', current_period_end: periodEnd },
        { id: '00000000-0000-0000-0000-000000000040', amount: 79 },
      );

      expect(notificationModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: '00000000-0000-0000-0000-000000000001',
        type: 'SUBSCRIPTION_RENEWAL_DUE',
        severity: 'WARNING',
        metadata: expect.objectContaining({ subscriptionId: '00000000-0000-0000-0000-000000000010', paymentId: '00000000-0000-0000-0000-000000000040', tier: 'GROWTH', amount: 79, currentPeriodEnd: periodEnd }),
      }));
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith('WEBHOOK_FANOUT', '00000000-0000-0000-0000-000000000001', { notificationId: '00000000-0000-0000-0000-000000000102' }, null, null);
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith('NOTIFICATION_DISPATCH', '00000000-0000-0000-0000-000000000001', { notificationId: '00000000-0000-0000-0000-000000000102' }, null, 'SUBSCRIPTION_RENEWAL_DUE');
      expect(result).toEqual({ id: '00000000-0000-0000-0000-000000000102', tenant_id: '00000000-0000-0000-0000-000000000001', type: 'SUBSCRIPTION_RENEWAL_DUE' });
    });
  });

  describe('createSubscriptionPastDueWarning', () => {
    test('creates a WARNING SUBSCRIPTION_PAST_DUE_WARNING notification, fans it out, and enqueues NOTIFICATION_DISPATCH', async () => {
      notificationModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000150', tenant_id: '00000000-0000-0000-0000-000000000001', type: 'SUBSCRIPTION_PAST_DUE_WARNING' });
      const periodEnd = new Date('2026-07-01T00:00:00Z');
      const suspendsAt = new Date('2026-07-08T00:00:00Z');

      const result = await notificationService.createSubscriptionPastDueWarning(
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', current_period_end: periodEnd },
        suspendsAt,
      );

      expect(notificationModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: '00000000-0000-0000-0000-000000000001',
        type: 'SUBSCRIPTION_PAST_DUE_WARNING',
        severity: 'WARNING',
        metadata: expect.objectContaining({ subscriptionId: '00000000-0000-0000-0000-000000000010', tier: 'STARTER', currentPeriodEnd: periodEnd, suspendsAt }),
      }));
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith('WEBHOOK_FANOUT', '00000000-0000-0000-0000-000000000001', { notificationId: '00000000-0000-0000-0000-000000000150' }, null, null);
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith('NOTIFICATION_DISPATCH', '00000000-0000-0000-0000-000000000001', { notificationId: '00000000-0000-0000-0000-000000000150' }, null, 'SUBSCRIPTION_PAST_DUE_WARNING');
      expect(result).toEqual({ id: '00000000-0000-0000-0000-000000000150', tenant_id: '00000000-0000-0000-0000-000000000001', type: 'SUBSCRIPTION_PAST_DUE_WARNING' });
    });
  });

  describe('createSubscriptionExpired', () => {
    test('creates an ERROR SUBSCRIPTION_EXPIRED notification, fans it out, and enqueues NOTIFICATION_DISPATCH', async () => {
      notificationModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000103', tenant_id: '00000000-0000-0000-0000-000000000001', type: 'SUBSCRIPTION_EXPIRED' });

      const result = await notificationService.createSubscriptionExpired({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'GROWTH' });

      expect(notificationModel.create).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: '00000000-0000-0000-0000-000000000001',
        type: 'SUBSCRIPTION_EXPIRED',
        severity: 'ERROR',
        metadata: { subscriptionId: '00000000-0000-0000-0000-000000000010', previousTier: 'GROWTH' },
      }));
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith('WEBHOOK_FANOUT', '00000000-0000-0000-0000-000000000001', { notificationId: '00000000-0000-0000-0000-000000000103' }, null, null);
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith('NOTIFICATION_DISPATCH', '00000000-0000-0000-0000-000000000001', { notificationId: '00000000-0000-0000-0000-000000000103' }, null, 'SUBSCRIPTION_EXPIRED');
      expect(result).toEqual({ id: '00000000-0000-0000-0000-000000000103', tenant_id: '00000000-0000-0000-0000-000000000001', type: 'SUBSCRIPTION_EXPIRED' });
    });
  });

  describe('createDocumentAuthorized', () => {
    test('fans out but never enqueues NOTIFICATION_DISPATCH (DOCUMENT_AUTHORIZED has no EMAIL channel)', async () => {
      notificationModel.findPendingDocumentAuthorized.mockResolvedValue(null);
      notificationModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000200', tenant_id: '00000000-0000-0000-0000-000000000001', type: 'DOCUMENT_AUTHORIZED' });

      await notificationService.createDocumentAuthorized(
        { access_key: '123', branch_code: '001', issue_point_code: '001', sequential: '1', buyer_name: 'Acme', buyer_id: '999', total: 10, issue_date: '2026-01-01', authorization_number: null },
        { id: '00000000-0000-0000-0000-000000000030', tenant_id: '00000000-0000-0000-0000-000000000001' },
      );

      expect(notificationModel.create).toHaveBeenCalled();
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith('WEBHOOK_FANOUT', '00000000-0000-0000-0000-000000000001', { notificationId: '00000000-0000-0000-0000-000000000200' }, null, null);
      expect(pendingEffectService.enqueue).not.toHaveBeenCalledWith('NOTIFICATION_DISPATCH', expect.anything(), expect.anything());
      expect(notificationModel.updateEmailStatus).not.toHaveBeenCalled();
    });
  });

  describe('getPreferences', () => {
    test('defaults every subscribable (type, channel) pair to enabled when nothing is stored', async () => {
      notificationPreferenceModel.findByTenantId.mockResolvedValue({});

      const prefs = await notificationService.getPreferences('00000000-0000-0000-0000-000000000001');

      // DOCUMENT_AUTHORIZED only supports IN_APP (no tenant-facing email exists for it).
      expect(prefs).toContainEqual({ type: 'DOCUMENT_AUTHORIZED', channel: 'IN_APP', enabled: true });
      expect(prefs.find((p) => p.type === 'DOCUMENT_AUTHORIZED' && p.channel === 'EMAIL')).toBeUndefined();
      // PAYMENT_VERIFIED supports both channels.
      expect(prefs).toContainEqual({ type: 'PAYMENT_VERIFIED', channel: 'IN_APP', enabled: true });
      expect(prefs).toContainEqual({ type: 'PAYMENT_VERIFIED', channel: 'EMAIL', enabled: true });
      // PRICE_CHANGE_ANNOUNCED is mandatory — never appears at all.
      expect(prefs.find((p) => p.type === 'PRICE_CHANGE_ANNOUNCED')).toBeUndefined();
    });

    test('reflects a stored explicit disable for one (type, channel) without affecting its sibling channel', async () => {
      notificationPreferenceModel.findByTenantId.mockResolvedValue({
        PAYMENT_VERIFIED: { EMAIL: false },
      });

      const prefs = await notificationService.getPreferences('00000000-0000-0000-0000-000000000001');

      expect(prefs).toContainEqual({ type: 'PAYMENT_VERIFIED', channel: 'EMAIL', enabled: false });
      expect(prefs).toContainEqual({ type: 'PAYMENT_VERIFIED', channel: 'IN_APP', enabled: true });
    });
  });

  describe('updatePreferences', () => {
    test('upserts then returns the full refreshed list', async () => {
      notificationPreferenceModel.upsertMany.mockResolvedValue();
      notificationPreferenceModel.findByTenantId.mockResolvedValue({ PAYMENT_VERIFIED: { EMAIL: false } });

      const updates = [{ type: 'PAYMENT_VERIFIED', channel: 'EMAIL', enabled: false }];
      const prefs = await notificationService.updatePreferences('00000000-0000-0000-0000-000000000001', updates);

      expect(notificationPreferenceModel.upsertMany).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', updates);
      expect(prefs).toContainEqual({ type: 'PAYMENT_VERIFIED', channel: 'EMAIL', enabled: false });
    });
  });
});
