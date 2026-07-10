jest.mock('../../../src/models/subscription.model');
jest.mock('../../../src/models/payment.model');
jest.mock('../../../src/models/payment-proof.model');
jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/tenant.model');
jest.mock('../../../src/models/tenant-event.model');
jest.mock('../../../src/services/tenant-quota.service');
jest.mock('../../../src/services/notification.service');
jest.mock('../../../src/services/email.service');

const subscriptionModel = require('../../../src/models/subscription.model');
const paymentModel = require('../../../src/models/payment.model');
const paymentProofModel = require('../../../src/models/payment-proof.model');
const documentModel = require('../../../src/models/document.model');
const tenantModel = require('../../../src/models/tenant.model');
const tenantEventModel = require('../../../src/models/tenant-event.model');
const tenantQuotaService = require('../../../src/services/tenant-quota.service');
const notificationService = require('../../../src/services/notification.service');
const emailService = require('../../../src/services/email.service');
const config = require('../../../src/config');
const subscriptionService = require('../../../src/services/subscription.service');

describe('SubscriptionService', () => {
  beforeEach(() => {
    notificationService.createPaymentReviewed.mockResolvedValue(null);
    notificationService.createSubscriptionRenewalDue.mockResolvedValue(null);
    notificationService.createSubscriptionExpired.mockResolvedValue(null);
    emailService.sendPaymentProofSubmitted.mockResolvedValue({ sent: false });
    emailService.sendPaymentReviewed.mockResolvedValue({ sent: true });
    emailService.sendSubscriptionRenewalDue.mockResolvedValue({ sent: true });
    emailService.sendSubscriptionExpired.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createSubscription', () => {
    test('rejects an invalid tier', async () => {
      await expect(subscriptionService.createSubscription(1, 'FREE'))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TIER' });
      expect(tenantModel.findById).not.toHaveBeenCalled();
    });

    test('rejects an invalid billingInterval', async () => {
      await expect(subscriptionService.createSubscription(1, 'STARTER', 'WEEKLY'))
        .rejects.toMatchObject({ statusCode: 400 });
      expect(tenantModel.findById).not.toHaveBeenCalled();
    });

    test('rejects when the tenant does not exist', async () => {
      tenantModel.findById.mockResolvedValue(null);

      await expect(subscriptionService.createSubscription(1, 'STARTER'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    test('rejects when the tenant already has a subscription in flight', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveOrPendingByTenantId.mockResolvedValue({ id: 5, status: 'PENDING_PAYMENT' });

      await expect(subscriptionService.createSubscription(1, 'STARTER'))
        .rejects.toMatchObject({ statusCode: 409, code: 'SUBSCRIPTION_ALREADY_IN_FLIGHT' });
      expect(subscriptionModel.create).not.toHaveBeenCalled();
    });

    test('creates a subscription and a payment priced from the tier (default MONTHLY), and logs an event', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveOrPendingByTenantId.mockResolvedValue(null);
      subscriptionModel.create.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER' });
      paymentModel.create.mockResolvedValue({ id: 20, subscription_id: 10, amount: 19.05, iva_rate: 0.05, iva_amount: 0.95, total_amount: 20 });

      const result = await subscriptionService.createSubscription(1, 'STARTER');

      expect(subscriptionModel.create).toHaveBeenCalledWith({ tenantId: 1, tier: 'STARTER', billingInterval: 'MONTHLY' });
      expect(paymentModel.create).toHaveBeenCalledWith({ subscriptionId: 10, amount: 19.05, ivaRate: 0.05, ivaAmount: 0.95, totalAmount: 20 });
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'SUBSCRIPTION_CREATED', { subscriptionId: 10, tier: 'STARTER', billingInterval: 'MONTHLY' });
      expect(result).toEqual({
        subscription: { id: 10, tenant_id: 1, tier: 'STARTER' },
        payment: { id: 20, subscription_id: 10, amount: 19.05, iva_rate: 0.05, iva_amount: 0.95, total_amount: 20 },
        bankTransfer: config.bankTransfer,
      });
    });

    test('prices from priceYearlyUsd and stores billing_interval when YEARLY is requested', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveOrPendingByTenantId.mockResolvedValue(null);
      subscriptionModel.create.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER', billing_interval: 'YEARLY' });
      paymentModel.create.mockResolvedValue({ id: 20, subscription_id: 10, amount: 190.48, iva_rate: 0.05, iva_amount: 9.52, total_amount: 200 });

      await subscriptionService.createSubscription(1, 'STARTER', 'YEARLY');

      expect(subscriptionModel.create).toHaveBeenCalledWith({ tenantId: 1, tier: 'STARTER', billingInterval: 'YEARLY' });
      expect(paymentModel.create).toHaveBeenCalledWith({ subscriptionId: 10, amount: 190.48, ivaRate: 0.05, ivaAmount: 9.52, totalAmount: 200 });
    });
  });

  describe('createSubscriptionForTenant', () => {
    test('rejects when the tenant does not exist', async () => {
      tenantModel.findById.mockResolvedValue(null);

      await expect(subscriptionService.createSubscriptionForTenant(1, 'STARTER'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    test('rejects when the tenant has not verified their email', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, status: 'PENDING_VERIFICATION' });

      await expect(subscriptionService.createSubscriptionForTenant(1, 'STARTER'))
        .rejects.toMatchObject({ statusCode: 403, code: 'EMAIL_VERIFICATION_REQUIRED' });
      expect(subscriptionModel.create).not.toHaveBeenCalled();
    });

    test('creates the subscription when the tenant is ACTIVE, regardless of sandbox status', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1, status: 'ACTIVE', sandbox: true });
      subscriptionModel.findActiveOrPendingByTenantId.mockResolvedValue(null);
      subscriptionModel.create.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER' });
      paymentModel.create.mockResolvedValue({ id: 20, subscription_id: 10, amount: 19 });

      const result = await subscriptionService.createSubscriptionForTenant(1, 'STARTER');

      expect(subscriptionModel.create).toHaveBeenCalledWith({ tenantId: 1, tier: 'STARTER', billingInterval: 'MONTHLY' });
      expect(result.subscription).toEqual({ id: 10, tenant_id: 1, tier: 'STARTER' });
    });
  });

  describe('requestTierChange', () => {
    beforeEach(() => {
      paymentModel.findPendingTierChangeBySubscriptionId.mockResolvedValue(null);
    });

    test('rejects an invalid tier', async () => {
      await expect(subscriptionService.requestTierChange(1, 'NOT_A_TIER'))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TIER' });
      expect(tenantModel.findById).not.toHaveBeenCalled();
    });

    test('rejects when the tenant does not exist', async () => {
      tenantModel.findById.mockResolvedValue(null);

      await expect(subscriptionService.requestTierChange(1, 'GROWTH'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    test('rejects when the tenant has no ACTIVE subscription', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveByTenantId.mockResolvedValue(null);

      await expect(subscriptionService.requestTierChange(1, 'GROWTH'))
        .rejects.toMatchObject({ statusCode: 409, code: 'NO_ACTIVE_SUBSCRIPTION' });
    });

    test('rejects when the requested tier matches the current tier', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({ id: 10, tier: 'GROWTH' });

      await expect(subscriptionService.requestTierChange(1, 'GROWTH'))
        .rejects.toMatchObject({ statusCode: 400, code: 'TIER_CHANGE_NO_OP' });
    });

    test('rejects when a downgrade is already scheduled', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({ id: 10, tier: 'GROWTH', pending_tier: 'STARTER' });

      await expect(subscriptionService.requestTierChange(1, 'BUSINESS'))
        .rejects.toMatchObject({ statusCode: 409, code: 'TIER_CHANGE_ALREADY_PENDING' });
    });

    test('rejects when an upgrade payment is already in flight', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({ id: 10, tier: 'GROWTH', pending_tier: null });
      paymentModel.findPendingTierChangeBySubscriptionId.mockResolvedValue({ id: 30, target_tier: 'BUSINESS' });

      await expect(subscriptionService.requestTierChange(1, 'BUSINESS'))
        .rejects.toMatchObject({ statusCode: 409, code: 'TIER_CHANGE_ALREADY_PENDING' });
    });

    test('downgrade: schedules pending_tier, creates no payment, logs TIER_CHANGE_SCHEDULED', async () => {
      const periodEnd = new Date('2026-07-01T00:00:00Z');
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'GROWTH', pending_tier: null, current_period_end: periodEnd,
      });
      subscriptionModel.scheduleDowngrade.mockResolvedValue({ id: 10, tier: 'GROWTH', pending_tier: 'STARTER' });

      const result = await subscriptionService.requestTierChange(1, 'STARTER');

      expect(subscriptionModel.scheduleDowngrade).toHaveBeenCalledWith(10, 'STARTER');
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGE_SCHEDULED', {
        subscriptionId: 10, fromTier: 'GROWTH', toTier: 'STARTER', effectiveAt: periodEnd,
      });
      expect(result).toEqual({
        subscription: { id: 10, tier: 'GROWTH', pending_tier: 'STARTER' },
        effectiveAt: periodEnd,
      });
    });

    test('upgrade: prorates the price difference by remaining period time, creates a TIER_CHANGE payment', async () => {
      const now = Date.now();
      const periodStart = new Date(now - 15 * 24 * 60 * 60 * 1000); // 15 days ago
      const periodEnd = new Date(now + 15 * 24 * 60 * 60 * 1000);   // 15 days from now (~50% remaining, 30-day period)
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'STARTER', pending_tier: null,
        billing_interval: 'MONTHLY', current_period_start: periodStart, current_period_end: periodEnd,
      });
      paymentModel.create.mockResolvedValue({ id: 30, subscription_id: 10, amount: 30, purpose: 'TIER_CHANGE', target_tier: 'GROWTH' });

      const result = await subscriptionService.requestTierChange(1, 'GROWTH');

      // GROWTH (90) - STARTER (20) = 70 gross, ~50% of the period remains -> ~35
      // gross, split at the current 5% IVA rate into a ~33.33 base + ~1.67 IVA.
      const [createArgs] = paymentModel.create.mock.calls[0];
      expect(createArgs.subscriptionId).toBe(10);
      expect(createArgs.purpose).toBe('TIER_CHANGE');
      expect(createArgs.targetTier).toBe('GROWTH');
      expect(createArgs.amount).toBeCloseTo(33.33, 0);
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGE_REQUESTED', expect.objectContaining({
        subscriptionId: 10, fromTier: 'STARTER', toTier: 'GROWTH',
      }));
      expect(result).toEqual({
        subscription: expect.objectContaining({ id: 10 }),
        payment: { id: 30, subscription_id: 10, amount: 30, purpose: 'TIER_CHANGE', target_tier: 'GROWTH' },
        bankTransfer: config.bankTransfer,
      });
    });

    test('upgrade: applies immediately with no payment when the prorated amount rounds to $0', async () => {
      const now = Date.now();
      const periodEnd = new Date(now - 1000); // already ended -> 0% remaining
      const periodStart = new Date(now - 30 * 24 * 60 * 60 * 1000);
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'STARTER', pending_tier: null,
        billing_interval: 'MONTHLY', current_period_start: periodStart, current_period_end: periodEnd,
      });
      subscriptionModel.applyTierChange.mockResolvedValue({ id: 10, tier: 'GROWTH' });

      const result = await subscriptionService.requestTierChange(1, 'GROWTH');

      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith(10, 'GROWTH');
      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'GROWTH');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith(1, 'GROWTH');
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGED', {
        subscriptionId: 10, fromTier: 'STARTER', toTier: 'GROWTH', totalAmount: 0,
      });
      expect(result).toEqual({ subscription: { id: 10, tier: 'GROWTH' }, payment: null, amount: 0 });
    });

    test('rejects an invalid billingInterval', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({ id: 10, tier: 'GROWTH', billing_interval: 'MONTHLY' });

      await expect(subscriptionService.requestTierChange(1, 'GROWTH', 'WEEKLY'))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_BILLING_INTERVAL' });
      expect(paymentModel.create).not.toHaveBeenCalled();
    });

    test('rejects when tier and billingInterval both match the current subscription', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({ id: 10, tier: 'GROWTH', billing_interval: 'MONTHLY' });

      await expect(subscriptionService.requestTierChange(1, 'GROWTH', 'MONTHLY'))
        .rejects.toMatchObject({ statusCode: 400, code: 'TIER_CHANGE_NO_OP' });
    });

    test('interval-only change (same tier): deferred, full price, no proration', async () => {
      const periodEnd = new Date('2026-08-01T00:00:00Z');
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'GROWTH', pending_tier: null,
        billing_interval: 'MONTHLY', current_period_end: periodEnd,
      });
      paymentModel.create.mockResolvedValue({ id: 40, subscription_id: 10, purpose: 'TIER_CHANGE', target_tier: 'GROWTH', target_billing_interval: 'YEARLY' });

      const result = await subscriptionService.requestTierChange(1, 'GROWTH', 'YEARLY');

      const [createArgs] = paymentModel.create.mock.calls[0];
      expect(createArgs.subscriptionId).toBe(10);
      expect(createArgs.purpose).toBe('TIER_CHANGE');
      expect(createArgs.targetTier).toBe('GROWTH');
      expect(createArgs.targetBillingInterval).toBe('YEARLY');
      // Full yearly-GROWTH sticker price (900), not prorated against the
      // remaining monthly period.
      expect(createArgs.totalAmount).toBe(900);
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGE_REQUESTED', expect.objectContaining({
        subscriptionId: 10, fromTier: 'GROWTH', toTier: 'GROWTH',
        fromBillingInterval: 'MONTHLY', toBillingInterval: 'YEARLY', effectiveAt: periodEnd,
      }));
      expect(result).toEqual({
        subscription: expect.objectContaining({ id: 10 }),
        payment: { id: 40, subscription_id: 10, purpose: 'TIER_CHANGE', target_tier: 'GROWTH', target_billing_interval: 'YEARLY' },
        bankTransfer: config.bankTransfer,
        effectiveAt: periodEnd,
      });
    });

    test('tier upgrade + interval change: deferred (not the immediate prorated path)', async () => {
      const now = Date.now();
      const periodStart = new Date(now - 15 * 24 * 60 * 60 * 1000);
      const periodEnd = new Date(now + 15 * 24 * 60 * 60 * 1000);
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'STARTER', pending_tier: null,
        billing_interval: 'MONTHLY', current_period_start: periodStart, current_period_end: periodEnd,
      });
      paymentModel.create.mockResolvedValue({ id: 41, subscription_id: 10, purpose: 'TIER_CHANGE', target_tier: 'GROWTH', target_billing_interval: 'YEARLY' });

      await subscriptionService.requestTierChange(1, 'GROWTH', 'YEARLY');

      expect(subscriptionModel.applyTierChange).not.toHaveBeenCalled();
      const [createArgs] = paymentModel.create.mock.calls[0];
      expect(createArgs.targetBillingInterval).toBe('YEARLY');
      expect(createArgs.totalAmount).toBe(900); // full yearly-GROWTH price, not prorated
    });

    test('tier downgrade + interval change: deferred and paid (unlike a plain same-interval downgrade)', async () => {
      const periodEnd = new Date('2026-08-01T00:00:00Z');
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'GROWTH', pending_tier: null,
        billing_interval: 'MONTHLY', current_period_end: periodEnd,
      });
      paymentModel.create.mockResolvedValue({ id: 42, subscription_id: 10, purpose: 'TIER_CHANGE', target_tier: 'STARTER', target_billing_interval: 'YEARLY' });

      const result = await subscriptionService.requestTierChange(1, 'STARTER', 'YEARLY');

      expect(subscriptionModel.scheduleDowngrade).not.toHaveBeenCalled();
      const [createArgs] = paymentModel.create.mock.calls[0];
      expect(createArgs.targetTier).toBe('STARTER');
      expect(createArgs.targetBillingInterval).toBe('YEARLY');
      expect(createArgs.totalAmount).toBe(200); // full yearly-STARTER price
      expect(result.subscription).toEqual(expect.objectContaining({ id: 10, tier: 'GROWTH' }));
    });

    describe('sandbox tenant', () => {
      test('downgrade applies immediately, free, no payment created', async () => {
        tenantModel.findById.mockResolvedValue({ id: 1, sandbox: true });
        subscriptionModel.findActiveByTenantId.mockResolvedValue({
          id: 10, tenant_id: 1, tier: 'GROWTH', pending_tier: null, billing_interval: 'MONTHLY',
        });
        subscriptionModel.applyTierChange.mockResolvedValue({ id: 10, tier: 'STARTER' });

        const result = await subscriptionService.requestTierChange(1, 'STARTER');

        expect(subscriptionModel.scheduleDowngrade).not.toHaveBeenCalled();
        expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith(10, 'STARTER', 'MONTHLY');
        expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'STARTER');
        expect(tenantQuotaService.setCap).toHaveBeenCalledWith(1, 'STARTER');
        expect(paymentModel.create).not.toHaveBeenCalled();
        expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGED', expect.objectContaining({
          subscriptionId: 10, fromTier: 'GROWTH', toTier: 'STARTER', totalAmount: 0,
        }));
        expect(result).toEqual({ subscription: { id: 10, tier: 'STARTER' }, payment: null, amount: 0 });
      });

      test('same-interval upgrade is priced at the FULL sticker price, not prorated', async () => {
        const now = Date.now();
        tenantModel.findById.mockResolvedValue({ id: 1, sandbox: true });
        subscriptionModel.findActiveByTenantId.mockResolvedValue({
          id: 10, tenant_id: 1, tier: 'STARTER', pending_tier: null, billing_interval: 'MONTHLY',
          current_period_start: new Date(now - 15 * 24 * 60 * 60 * 1000),
          current_period_end: new Date(now + 15 * 24 * 60 * 60 * 1000), // ~50% remaining — would prorate to ~30 in production
        });
        paymentModel.create.mockResolvedValue({ id: 50, subscription_id: 10, purpose: 'TIER_CHANGE', target_tier: 'GROWTH' });

        const result = await subscriptionService.requestTierChange(1, 'GROWTH');

        const [createArgs] = paymentModel.create.mock.calls[0];
        expect(createArgs.targetTier).toBe('GROWTH');
        expect(createArgs.targetBillingInterval).toBe('MONTHLY');
        expect(createArgs.totalAmount).toBe(90); // full monthly-GROWTH price, not the ~50%-remaining prorated amount
        expect(subscriptionModel.applyTierChange).not.toHaveBeenCalled();
        expect(result).toEqual({ subscription: expect.objectContaining({ id: 10 }), payment: expect.objectContaining({ id: 50 }), bankTransfer: config.bankTransfer });
      });

      test('interval-changing upgrade is priced at the full new-interval price, same as production', async () => {
        tenantModel.findById.mockResolvedValue({ id: 1, sandbox: true });
        subscriptionModel.findActiveByTenantId.mockResolvedValue({
          id: 10, tenant_id: 1, tier: 'STARTER', pending_tier: null, billing_interval: 'MONTHLY',
        });
        paymentModel.create.mockResolvedValue({ id: 51, subscription_id: 10, purpose: 'TIER_CHANGE', target_tier: 'GROWTH', target_billing_interval: 'YEARLY' });

        await subscriptionService.requestTierChange(1, 'GROWTH', 'YEARLY');

        const [createArgs] = paymentModel.create.mock.calls[0];
        expect(createArgs.targetTier).toBe('GROWTH');
        expect(createArgs.targetBillingInterval).toBe('YEARLY');
        expect(createArgs.totalAmount).toBe(900); // full yearly-GROWTH price
      });
    });
  });

  describe('applyTierChangeIfLinked', () => {
    test('is a no-op when no payment is linked to the document', async () => {
      paymentModel.findByInvoiceDocumentId.mockResolvedValue(null);

      const result = await subscriptionService.applyTierChangeIfLinked(999);

      expect(result).toBeNull();
      expect(tenantModel.updateTier).not.toHaveBeenCalled();
    });

    test('is a no-op for a non-TIER_CHANGE payment', async () => {
      paymentModel.findByInvoiceDocumentId.mockResolvedValue({ id: 30, purpose: 'INITIAL', status: 'VERIFIED' });

      const result = await subscriptionService.applyTierChangeIfLinked(999);

      expect(result).toBeNull();
    });

    test('is a no-op when the payment is not yet VERIFIED', async () => {
      paymentModel.findByInvoiceDocumentId.mockResolvedValue({ id: 30, purpose: 'TIER_CHANGE', status: 'REPORTED' });

      const result = await subscriptionService.applyTierChangeIfLinked(999);

      expect(result).toBeNull();
    });

    test('flips the tier, grants the new quota, stamps the payment period, and logs TIER_CHANGED', async () => {
      const periodStart = new Date('2026-06-01T00:00:00Z');
      const periodEnd = new Date('2026-07-01T00:00:00Z');
      paymentModel.findByInvoiceDocumentId.mockResolvedValue({
        id: 30, subscription_id: 10, purpose: 'TIER_CHANGE', status: 'VERIFIED', target_tier: 'GROWTH',
      });
      subscriptionModel.findById.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'STARTER', current_period_start: periodStart, current_period_end: periodEnd,
      });
      subscriptionModel.applyTierChange.mockResolvedValue({ id: 10, tier: 'GROWTH' });

      const result = await subscriptionService.applyTierChangeIfLinked(999);

      expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith(10, 'GROWTH');
      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'GROWTH');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith(1, 'GROWTH');
      expect(paymentModel.updateStatus).toHaveBeenCalledWith(30, 'VERIFIED', {
        period_start: periodStart, period_end: periodEnd,
      });
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGED', {
        subscriptionId: 10, fromTier: 'STARTER', toTier: 'GROWTH', paymentId: 30,
      });
      expect(result).toEqual({ id: 10, tier: 'GROWTH' });
    });

    test('a payment with target_billing_interval set schedules the change for period-end instead of applying it now', async () => {
      const periodEnd = new Date('2026-08-01T00:00:00Z');
      paymentModel.findByInvoiceDocumentId.mockResolvedValue({
        id: 31, subscription_id: 10, purpose: 'TIER_CHANGE', status: 'VERIFIED',
        target_tier: 'STARTER', target_billing_interval: 'YEARLY',
      });
      subscriptionModel.findById.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'GROWTH', billing_interval: 'MONTHLY', current_period_end: periodEnd,
      });
      subscriptionModel.scheduleDowngrade.mockResolvedValue({ id: 10, tier: 'GROWTH', pending_tier: 'STARTER', pending_billing_interval: 'YEARLY' });

      const result = await subscriptionService.applyTierChangeIfLinked(999);

      expect(subscriptionModel.scheduleDowngrade).toHaveBeenCalledWith(10, 'STARTER', 'YEARLY');
      expect(subscriptionModel.applyTierChange).not.toHaveBeenCalled();
      expect(tenantModel.updateTier).not.toHaveBeenCalled();
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGE_SCHEDULED', {
        subscriptionId: 10, fromTier: 'GROWTH', toTier: 'STARTER',
        fromBillingInterval: 'MONTHLY', toBillingInterval: 'YEARLY',
        effectiveAt: periodEnd, paymentId: 31,
      });
      expect(result).toEqual({ id: 10, tier: 'GROWTH', pending_tier: 'STARTER', pending_billing_interval: 'YEARLY' });
    });
  });

  describe('applyScheduledTierChanges', () => {
    test('applies every due downgrade, rolls the period forward, and reports the count', async () => {
      const periodEnd1 = new Date('2026-06-15T00:00:00Z');
      const periodEnd2 = new Date('2026-06-20T00:00:00Z');
      subscriptionModel.findDuePendingDowngrades.mockResolvedValue([
        { id: 10, tenant_id: 1, tier: 'GROWTH', pending_tier: 'STARTER', pending_billing_interval: null, billing_interval: 'MONTHLY', current_period_end: periodEnd1 },
        { id: 11, tenant_id: 2, tier: 'BUSINESS', pending_tier: 'GROWTH', pending_billing_interval: null, billing_interval: 'YEARLY', current_period_end: periodEnd2 },
      ]);

      const result = await subscriptionService.applyScheduledTierChanges();

      expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith(10, 'STARTER', null);
      expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith(11, 'GROWTH', null);
      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'STARTER');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith(1, 'STARTER');
      expect(tenantModel.updateTier).toHaveBeenCalledWith(2, 'GROWTH');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith(2, 'GROWTH');
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGED', {
        subscriptionId: 10, fromTier: 'GROWTH', toTier: 'STARTER', fromBillingInterval: 'MONTHLY', toBillingInterval: 'MONTHLY',
      });

      // Rolled forward from the OLD current_period_end, not "now" — +1 month for
      // subscription 10 (MONTHLY), +1 year for subscription 11 (YEARLY).
      const call10 = subscriptionModel.updateStatus.mock.calls.find((c) => c[0] === 10);
      expect(call10[1]).toBe('ACTIVE');
      expect(call10[2].current_period_start).toEqual(periodEnd1);
      expect(call10[2].current_period_end.getMonth()).toBe((periodEnd1.getMonth() + 1) % 12);

      const call11 = subscriptionModel.updateStatus.mock.calls.find((c) => c[0] === 11);
      expect(call11[1]).toBe('ACTIVE');
      expect(call11[2].current_period_start).toEqual(periodEnd2);
      expect(call11[2].current_period_end.getFullYear()).toBe(periodEnd2.getFullYear() + 1);

      expect(result).toEqual({ applied: 2 });
    });

    test('reports zero when nothing is due', async () => {
      subscriptionModel.findDuePendingDowngrades.mockResolvedValue([]);

      const result = await subscriptionService.applyScheduledTierChanges();

      expect(result).toEqual({ applied: 0 });
      expect(subscriptionModel.applyTierChange).not.toHaveBeenCalled();
    });

    test('a due paid interval change rolls the period forward using the NEW interval and stamps the funding payment', async () => {
      const periodEnd = new Date('2026-06-15T00:00:00Z');
      subscriptionModel.findDuePendingDowngrades.mockResolvedValue([
        { id: 10, tenant_id: 1, tier: 'GROWTH', pending_tier: 'STARTER', pending_billing_interval: 'YEARLY', billing_interval: 'MONTHLY', current_period_end: periodEnd },
      ]);
      paymentModel.findBySubscriptionId.mockResolvedValue([
        { id: 50, purpose: 'TIER_CHANGE', status: 'VERIFIED', invoice_document_id: 900, period_start: null },
      ]);

      const result = await subscriptionService.applyScheduledTierChanges();

      expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith(10, 'STARTER', 'YEARLY');

      const call10 = subscriptionModel.updateStatus.mock.calls.find((c) => c[0] === 10);
      expect(call10[2].current_period_start).toEqual(periodEnd);
      // Rolled forward using the NEW (YEARLY) interval, not the old MONTHLY one.
      expect(call10[2].current_period_end.getFullYear()).toBe(periodEnd.getFullYear() + 1);

      expect(paymentModel.updateStatus).toHaveBeenCalledWith(50, 'VERIFIED', {
        period_start: call10[2].current_period_start,
        period_end: call10[2].current_period_end,
      });
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGED', {
        subscriptionId: 10, fromTier: 'GROWTH', toTier: 'STARTER',
        fromBillingInterval: 'MONTHLY', toBillingInterval: 'YEARLY',
      });
      expect(result).toEqual({ applied: 1 });
    });
  });

  describe('processDueRenewals', () => {
    beforeEach(() => {
      subscriptionModel.findDueForRenewalReminder.mockResolvedValue([]);
      subscriptionModel.findExpiredPastGrace.mockResolvedValue([]);
    });

    test('opens a renewal payment, logs RENEWAL_DUE, and notifies the tenant', async () => {
      const periodEnd = new Date('2026-07-06T00:00:00Z');
      subscriptionModel.findDueForRenewalReminder.mockResolvedValue([
        { id: 10, tenant_id: 1, tier: 'STARTER', billing_interval: 'MONTHLY', current_period_end: periodEnd },
      ]);
      paymentModel.create.mockResolvedValue({ id: 40, subscription_id: 10, amount: 19.05, iva_rate: 0.05, iva_amount: 0.95, total_amount: 20, purpose: 'RENEWAL' });

      const result = await subscriptionService.processDueRenewals();

      expect(paymentModel.create).toHaveBeenCalledWith({ subscriptionId: 10, amount: 19.05, ivaRate: 0.05, ivaAmount: 0.95, totalAmount: 20, purpose: 'RENEWAL' });
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'RENEWAL_DUE', {
        subscriptionId: 10, paymentId: 40, tier: 'STARTER', currentPeriodEnd: periodEnd,
      });
      expect(notificationService.createSubscriptionRenewalDue).toHaveBeenCalledWith(
        { id: 10, tenant_id: 1, tier: 'STARTER', billing_interval: 'MONTHLY', current_period_end: periodEnd },
        { id: 40, subscription_id: 10, amount: 19.05, iva_rate: 0.05, iva_amount: 0.95, total_amount: 20, purpose: 'RENEWAL' },
      );
      expect(emailService.sendSubscriptionRenewalDue).toHaveBeenCalledWith(
        { id: 10, tenant_id: 1, tier: 'STARTER', billing_interval: 'MONTHLY', current_period_end: periodEnd },
        { id: 40, subscription_id: 10, amount: 19.05, iva_rate: 0.05, iva_amount: 0.95, total_amount: 20, purpose: 'RENEWAL' },
      );
      expect(result).toEqual({ remindersSent: 1, expired: 0 });
    });

    test('prices the renewal from priceYearlyUsd when billing_interval is YEARLY', async () => {
      subscriptionModel.findDueForRenewalReminder.mockResolvedValue([
        { id: 10, tenant_id: 1, tier: 'GROWTH', billing_interval: 'YEARLY', current_period_end: new Date() },
      ]);
      paymentModel.create.mockResolvedValue({ id: 40 });

      await subscriptionService.processDueRenewals();

      expect(paymentModel.create).toHaveBeenCalledWith({ subscriptionId: 10, amount: 857.14, ivaRate: 0.05, ivaAmount: 42.86, totalAmount: 900, purpose: 'RENEWAL' });
    });

    test('downgrades an expired subscription to FREE, logs SUBSCRIPTION_EXPIRED, and notifies the tenant', async () => {
      subscriptionModel.findExpiredPastGrace.mockResolvedValue([
        { id: 10, tenant_id: 1, tier: 'GROWTH' },
      ]);
      subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'EXPIRED' });

      const result = await subscriptionService.processDueRenewals();

      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'FREE');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith(1, 'FREE');
      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(10, 'EXPIRED');
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'SUBSCRIPTION_EXPIRED', {
        subscriptionId: 10, previousTier: 'GROWTH',
      });
      expect(notificationService.createSubscriptionExpired).toHaveBeenCalledWith({ id: 10, tenant_id: 1, tier: 'GROWTH' });
      expect(emailService.sendSubscriptionExpired).toHaveBeenCalledWith({ id: 10, tenant_id: 1, tier: 'GROWTH' });
      expect(result).toEqual({ remindersSent: 0, expired: 1 });
    });

    test('reports zero/zero when nothing is due either way', async () => {
      const result = await subscriptionService.processDueRenewals();

      expect(result).toEqual({ remindersSent: 0, expired: 0 });
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(tenantModel.updateTier).not.toHaveBeenCalled();
    });
  });

  describe('applyRenewalIfLinked', () => {
    test('is a no-op when no payment is linked to the document', async () => {
      paymentModel.findByInvoiceDocumentId.mockResolvedValue(null);

      const result = await subscriptionService.applyRenewalIfLinked(999);

      expect(result).toBeNull();
      expect(subscriptionModel.updateStatus).not.toHaveBeenCalled();
    });

    test('is a no-op for a non-RENEWAL payment', async () => {
      paymentModel.findByInvoiceDocumentId.mockResolvedValue({ id: 40, purpose: 'TIER_CHANGE', status: 'VERIFIED' });

      const result = await subscriptionService.applyRenewalIfLinked(999);

      expect(result).toBeNull();
    });

    test('is a no-op when the payment is not yet VERIFIED', async () => {
      paymentModel.findByInvoiceDocumentId.mockResolvedValue({ id: 40, purpose: 'RENEWAL', status: 'REPORTED' });

      const result = await subscriptionService.applyRenewalIfLinked(999);

      expect(result).toBeNull();
    });

    test('extends the period from the OLD current_period_end, stamps the payment, and logs SUBSCRIPTION_RENEWED', async () => {
      const oldPeriodEnd = new Date('2026-07-01T00:00:00Z');
      paymentModel.findByInvoiceDocumentId.mockResolvedValue({
        id: 40, subscription_id: 10, purpose: 'RENEWAL', status: 'VERIFIED',
      });
      subscriptionModel.findById.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'STARTER', billing_interval: 'MONTHLY', current_period_end: oldPeriodEnd,
      });
      subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'ACTIVE' });

      const result = await subscriptionService.applyRenewalIfLinked(999);

      const [, , extra] = subscriptionModel.updateStatus.mock.calls[0];
      expect(extra.current_period_start).toEqual(oldPeriodEnd);
      const monthsApart = (extra.current_period_end.getFullYear() - extra.current_period_start.getFullYear()) * 12
        + (extra.current_period_end.getMonth() - extra.current_period_start.getMonth());
      expect(monthsApart).toBe(1);

      expect(paymentModel.updateStatus).toHaveBeenCalledWith(40, 'VERIFIED', {
        period_start: extra.current_period_start,
        period_end: extra.current_period_end,
      });
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'SUBSCRIPTION_RENEWED', {
        subscriptionId: 10, tier: 'STARTER', periodStart: extra.current_period_start, periodEnd: extra.current_period_end,
      });
      expect(result).toEqual({ id: 10, status: 'ACTIVE' });
    });
  });

  describe('submitPaymentProof', () => {
    const files = [{ buffer: Buffer.from('test'), filename: 'receipt.pdf', mimeType: 'application/pdf' }];

    beforeEach(() => {
      paymentProofModel.countActiveByPaymentId.mockResolvedValue(0);
    });

    test('rejects when the payment does not exist', async () => {
      paymentModel.findById.mockResolvedValue(null);

      await expect(subscriptionService.submitPaymentProof(20, 1, files))
        .rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
    });

    test('rejects when the payment belongs to a different tenant', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10, status: 'PENDING' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 2 });

      await expect(subscriptionService.submitPaymentProof(20, 1, files))
        .rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
    });

    test('rejects when the payment has already been VERIFIED', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10, status: 'VERIFIED' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1 });

      await expect(subscriptionService.submitPaymentProof(20, 1, files))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    test('rejects when the cumulative active file count would exceed the limit', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10, status: 'PENDING' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1 });
      paymentProofModel.countActiveByPaymentId.mockResolvedValue(10);

      await expect(subscriptionService.submitPaymentProof(20, 1, files))
        .rejects.toMatchObject({ statusCode: 400, code: 'PROOF_FILE_LIMIT_REACHED' });
      expect(paymentProofModel.createMany).not.toHaveBeenCalled();
    });

    test('allows re-submitting after REJECTED, adds new files without touching old ones, and clears the old rejection_reason_code', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10, status: 'REJECTED', rejection_reason_code: 'TRANSFER_NOT_FOUND' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1 });
      paymentProofModel.createMany.mockResolvedValue([{ id: 2, payment_id: 20, filename: files[0].filename, mime_type: files[0].mimeType, reference_number: 'REF-123', active: true, created_at: new Date() }]);
      paymentModel.updateStatus.mockResolvedValue({ id: 20, status: 'REPORTED' });

      await subscriptionService.submitPaymentProof(20, 1, files, 'REF-123');

      expect(paymentProofModel.createMany).toHaveBeenCalledWith(20, files, 'REF-123');
      expect(paymentModel.updateStatus).toHaveBeenCalledWith(20, 'REPORTED', {
        reported_at: expect.any(Date),
        rejection_reason_code: null,
      });
    });

    test('stores the files and moves the payment to REPORTED', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10, status: 'PENDING' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1 });
      paymentProofModel.createMany.mockResolvedValue([
        { id: 1, payment_id: 20, filename: 'receipt.pdf', mime_type: 'application/pdf', reference_number: 'REF-123', active: true, created_at: new Date('2026-06-01') },
      ]);
      paymentModel.updateStatus.mockResolvedValue({ id: 20, status: 'REPORTED' });

      const result = await subscriptionService.submitPaymentProof(20, 1, files, 'REF-123');

      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'PAYMENT_REPORTED', { paymentId: 20, proofCount: 1, referenceNumber: 'REF-123' });
      expect(result).toEqual({
        payment: { id: 20, status: 'REPORTED' },
        proofs: [{ id: 1, filename: 'receipt.pdf', mimeType: 'application/pdf', referenceNumber: 'REF-123', active: true, createdAt: new Date('2026-06-01') }],
      });
    });

    test('accepts multiple files in one submission', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10, status: 'PENDING' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1 });
      const multiFiles = [
        { buffer: Buffer.from('a'), filename: 'front.pdf', mimeType: 'application/pdf' },
        { buffer: Buffer.from('b'), filename: 'back.pdf', mimeType: 'application/pdf' },
      ];
      paymentProofModel.createMany.mockResolvedValue([
        { id: 1, payment_id: 20, filename: 'front.pdf', mime_type: 'application/pdf', active: true, created_at: new Date() },
        { id: 2, payment_id: 20, filename: 'back.pdf', mime_type: 'application/pdf', active: true, created_at: new Date() },
      ]);
      paymentModel.updateStatus.mockResolvedValue({ id: 20, status: 'REPORTED' });

      const result = await subscriptionService.submitPaymentProof(20, 1, multiFiles, 'REF-123');

      expect(paymentProofModel.createMany).toHaveBeenCalledWith(20, multiFiles, 'REF-123');
      expect(result.proofs).toHaveLength(2);
    });

    test('notifies the operator (fire-and-forget) with the tenant that owns the payment', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10, status: 'PENDING' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1 });
      paymentProofModel.createMany.mockResolvedValue([]);
      paymentModel.updateStatus.mockResolvedValue({ id: 20, status: 'REPORTED' });
      tenantModel.findById.mockResolvedValue({ id: 1, email: 'tenant@example.com' });

      await subscriptionService.submitPaymentProof(20, 1, files, 'REF-123');

      expect(emailService.sendPaymentProofSubmitted).toHaveBeenCalledWith(
        { id: 20, status: 'REPORTED' },
        { id: 10, tenant_id: 1 },
        { id: 1, email: 'tenant@example.com' },
        'REF-123',
      );
    });
  });

  describe('getPaymentProofFile (admin)', () => {
    test('rejects when the proof does not exist', async () => {
      paymentProofModel.findByIdAndPaymentId.mockResolvedValue(null);

      await expect(subscriptionService.getPaymentProofFile(20, 1)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('returns an inactive (soft-deleted) file too — admin sees full history', async () => {
      paymentProofModel.findByIdAndPaymentId.mockResolvedValue({
        id: 1, payment_id: 20, file: Buffer.from('x'), filename: 'receipt.pdf', mime_type: 'application/pdf', active: false,
      });

      const result = await subscriptionService.getPaymentProofFile(20, 1);

      expect(result).toEqual({ buffer: Buffer.from('x'), filename: 'receipt.pdf', mimeType: 'application/pdf' });
    });
  });

  describe('getPaymentProofFileForTenant', () => {
    test('rejects when the payment does not belong to the tenant', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue(null);

      await expect(subscriptionService.getPaymentProofFileForTenant(20, 1, 1)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('rejects (404) an inactive (deleted) file — tenant loses access once deleted', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue({ id: 20, subscription_id: 10 });
      paymentProofModel.findByIdAndPaymentId.mockResolvedValue({ id: 1, active: false });

      await expect(subscriptionService.getPaymentProofFileForTenant(20, 1, 1)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('returns an active file', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue({ id: 20, subscription_id: 10 });
      paymentProofModel.findByIdAndPaymentId.mockResolvedValue({
        id: 1, file: Buffer.from('x'), filename: 'receipt.pdf', mime_type: 'application/pdf', active: true,
      });

      const result = await subscriptionService.getPaymentProofFileForTenant(20, 1, 1);

      expect(result).toEqual({ buffer: Buffer.from('x'), filename: 'receipt.pdf', mimeType: 'application/pdf' });
    });
  });

  describe('listPaymentProofsForTenant', () => {
    test('rejects when the payment does not belong to the tenant', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue(null);

      await expect(subscriptionService.listPaymentProofsForTenant(20, 1)).rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
    });

    test('returns only active proofs, formatted', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue({ id: 20 });
      paymentProofModel.findActiveByPaymentId.mockResolvedValue([
        { id: 1, filename: 'a.pdf', mime_type: 'application/pdf', active: true, created_at: new Date('2026-06-01') },
      ]);

      const result = await subscriptionService.listPaymentProofsForTenant(20, 1);

      expect(result).toEqual([{ id: 1, filename: 'a.pdf', mimeType: 'application/pdf', active: true, createdAt: new Date('2026-06-01') }]);
    });
  });

  describe('listPaymentProofsForAdmin', () => {
    test('returns every proof including inactive ones', async () => {
      paymentProofModel.findAllByPaymentId.mockResolvedValue([
        { id: 1, filename: 'a.pdf', mime_type: 'application/pdf', active: true, created_at: new Date() },
        { id: 2, filename: 'b.pdf', mime_type: 'application/pdf', active: false, created_at: new Date() },
      ]);

      const result = await subscriptionService.listPaymentProofsForAdmin(20);

      expect(result).toHaveLength(2);
      expect(result[1].active).toBe(false);
    });
  });

  describe('deletePaymentProofForTenant', () => {
    test('rejects when the payment does not belong to the tenant', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue(null);

      await expect(subscriptionService.deletePaymentProofForTenant(20, 1, 1)).rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
    });

    test('rejects once the payment is VERIFIED', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue({ id: 20, status: 'VERIFIED' });

      await expect(subscriptionService.deletePaymentProofForTenant(20, 1, 1)).rejects.toMatchObject({ statusCode: 409 });
      expect(paymentProofModel.softDelete).not.toHaveBeenCalled();
    });

    test('rejects when the proof does not exist for this payment', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue({ id: 20, status: 'PENDING' });
      paymentProofModel.softDelete.mockResolvedValue(null);

      await expect(subscriptionService.deletePaymentProofForTenant(20, 1, 1)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('soft-deletes the proof and returns it formatted', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue({ id: 20, status: 'PENDING' });
      paymentProofModel.softDelete.mockResolvedValue({
        id: 1, filename: 'a.pdf', mime_type: 'application/pdf', active: false, created_at: new Date('2026-06-01'),
      });

      const result = await subscriptionService.deletePaymentProofForTenant(20, 1, 1);

      expect(paymentProofModel.softDelete).toHaveBeenCalledWith(1, 20);
      expect(result).toEqual({ id: 1, filename: 'a.pdf', mimeType: 'application/pdf', active: false, createdAt: new Date('2026-06-01') });
    });
  });

  describe('reviewPayment', () => {
    test('rejects an invalid decision', async () => {
      await expect(subscriptionService.reviewPayment(20, 'MAYBE')).rejects.toMatchObject({ statusCode: 400 });
      expect(paymentModel.findById).not.toHaveBeenCalled();
    });

    test('VERIFIED moves the linked subscription to PAYMENT_RECEIVED for an INITIAL payment', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10, purpose: 'INITIAL' });
      paymentModel.updateStatus.mockResolvedValue({ id: 20, status: 'VERIFIED' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, status: 'PENDING_PAYMENT' });
      subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'PAYMENT_RECEIVED' });

      const result = await subscriptionService.reviewPayment(20, 'VERIFIED');

      expect(paymentModel.updateStatus).toHaveBeenCalledWith(20, 'VERIFIED', { verified_at: expect.any(Date) });
      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(10, 'PAYMENT_RECEIVED');
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'PAYMENT_VERIFIED', { paymentId: 20 });
      expect(result.subscription).toEqual({ id: 10, status: 'PAYMENT_RECEIVED' });
      expect(notificationService.createPaymentReviewed).toHaveBeenCalledWith(
        { id: 20, status: 'VERIFIED' }, { id: 10, status: 'PAYMENT_RECEIVED' }, 'VERIFIED',
      );
      expect(emailService.sendPaymentReviewed).toHaveBeenCalledWith(
        { id: 20, status: 'VERIFIED' }, { id: 10, status: 'PAYMENT_RECEIVED' }, 'VERIFIED',
      );
    });

    test('VERIFIED leaves an already-ACTIVE subscription untouched for a TIER_CHANGE payment', async () => {
      paymentModel.findById.mockResolvedValue({ id: 21, subscription_id: 11, purpose: 'TIER_CHANGE' });
      paymentModel.updateStatus.mockResolvedValue({ id: 21, status: 'VERIFIED' });
      subscriptionModel.findById.mockResolvedValue({ id: 11, tenant_id: 1, status: 'ACTIVE' });

      const result = await subscriptionService.reviewPayment(21, 'VERIFIED');

      expect(subscriptionModel.updateStatus).not.toHaveBeenCalled();
      expect(result.subscription).toEqual({ id: 11, tenant_id: 1, status: 'ACTIVE' });
    });

    test('VERIFIED leaves an already-ACTIVE subscription untouched for a RENEWAL payment', async () => {
      paymentModel.findById.mockResolvedValue({ id: 22, subscription_id: 12, purpose: 'RENEWAL' });
      paymentModel.updateStatus.mockResolvedValue({ id: 22, status: 'VERIFIED' });
      subscriptionModel.findById.mockResolvedValue({ id: 12, tenant_id: 1, status: 'ACTIVE' });

      const result = await subscriptionService.reviewPayment(22, 'VERIFIED');

      expect(subscriptionModel.updateStatus).not.toHaveBeenCalled();
      expect(result.subscription).toEqual({ id: 12, tenant_id: 1, status: 'ACTIVE' });
    });

    test('REJECTED leaves the subscription untouched and stores the rejection reason code', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10 });
      paymentModel.updateStatus.mockResolvedValue({ id: 20, status: 'REJECTED' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, status: 'PENDING_PAYMENT' });

      const result = await subscriptionService.reviewPayment(20, 'REJECTED', 'TRANSFER_NOT_FOUND');

      expect(paymentModel.updateStatus).toHaveBeenCalledWith(20, 'REJECTED', {
        rejection_reason_code: 'TRANSFER_NOT_FOUND',
      });
      expect(subscriptionModel.updateStatus).not.toHaveBeenCalled();
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'PAYMENT_REJECTED', { paymentId: 20 });
      expect(result.subscription).toEqual({ id: 10, tenant_id: 1, status: 'PENDING_PAYMENT' });
      expect(notificationService.createPaymentReviewed).toHaveBeenCalledWith(
        { id: 20, status: 'REJECTED' }, { id: 10, tenant_id: 1, status: 'PENDING_PAYMENT' }, 'REJECTED',
      );
      expect(emailService.sendPaymentReviewed).toHaveBeenCalledWith(
        { id: 20, status: 'REJECTED' }, { id: 10, tenant_id: 1, status: 'PENDING_PAYMENT' }, 'REJECTED',
      );
    });

    test('rejects REJECTED decision with a missing rejectionReasonCode', async () => {
      await expect(subscriptionService.reviewPayment(20, 'REJECTED'))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_REJECTION_REASON' });
      expect(paymentModel.findById).not.toHaveBeenCalled();
    });

    test('rejects REJECTED decision with an unrecognized rejectionReasonCode', async () => {
      await expect(subscriptionService.reviewPayment(20, 'REJECTED', 'NOT_A_REASON'))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_REJECTION_REASON' });
      expect(paymentModel.findById).not.toHaveBeenCalled();
    });

    test('rejects when the payment does not exist', async () => {
      paymentModel.findById.mockResolvedValue(null);

      await expect(subscriptionService.reviewPayment(999, 'VERIFIED'))
        .rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
    });
  });

  describe('activateIfLinked', () => {
    beforeEach(() => {
      paymentModel.findBySubscriptionId.mockResolvedValue([]);
    });

    test('is a no-op when no subscription is linked to the document', async () => {
      subscriptionModel.findByInitialInvoiceDocumentId.mockResolvedValue(null);

      const result = await subscriptionService.activateIfLinked(999);

      expect(result).toBeNull();
      expect(tenantModel.updateTier).not.toHaveBeenCalled();
    });

    test('is a no-op when the linked subscription is not awaiting invoice processing', async () => {
      subscriptionModel.findByInitialInvoiceDocumentId.mockResolvedValue({ id: 10, status: 'CANCELLED' });

      const result = await subscriptionService.activateIfLinked(999);

      expect(result).toBeNull();
      expect(tenantModel.updateTier).not.toHaveBeenCalled();
    });

    test('activates the subscription and grants the tier when authorized (MONTHLY, +1 month)', async () => {
      subscriptionModel.findByInitialInvoiceDocumentId.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'STARTER', status: 'INVOICE_PROCESSING', billing_interval: 'MONTHLY',
      });
      subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'ACTIVE' });

      const result = await subscriptionService.activateIfLinked(999);

      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(10, 'ACTIVE', {
        current_period_start: expect.any(Date),
        current_period_end: expect.any(Date),
      });
      const [, , extra] = subscriptionModel.updateStatus.mock.calls[0];
      const monthsApart = (extra.current_period_end.getFullYear() - extra.current_period_start.getFullYear()) * 12
        + (extra.current_period_end.getMonth() - extra.current_period_start.getMonth());
      expect(monthsApart).toBe(1);
      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'STARTER');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith(1, 'STARTER');
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'SUBSCRIPTION_ACTIVATED', { subscriptionId: 10, tier: 'STARTER' });
      expect(result).toEqual({ id: 10, status: 'ACTIVE' });
    });

    test('uses a +1 year period when billing_interval is YEARLY', async () => {
      subscriptionModel.findByInitialInvoiceDocumentId.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'STARTER', status: 'INVOICE_PROCESSING', billing_interval: 'YEARLY',
      });
      subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'ACTIVE' });

      await subscriptionService.activateIfLinked(999);

      const [, , extra] = subscriptionModel.updateStatus.mock.calls[0];
      expect(extra.current_period_end.getFullYear() - extra.current_period_start.getFullYear()).toBe(1);
    });

    test('stamps period_start/period_end onto the verified payment that funded this cycle', async () => {
      subscriptionModel.findByInitialInvoiceDocumentId.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'STARTER', status: 'INVOICE_PROCESSING', billing_interval: 'MONTHLY',
      });
      subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'ACTIVE' });
      paymentModel.findBySubscriptionId.mockResolvedValue([
        { id: 20, status: 'VERIFIED', period_start: null },
      ]);

      await subscriptionService.activateIfLinked(999);

      expect(paymentModel.updateStatus).toHaveBeenCalledWith(20, 'VERIFIED', {
        period_start: expect.any(Date),
        period_end: expect.any(Date),
      });
    });
  });

  describe('linkInvoice', () => {
    const accessKey = '1234567890123456789012345678901234567890123456789';

    beforeEach(() => {
      paymentModel.findBySubscriptionId.mockResolvedValue([]);
      // Explicit, not implicit via jest.clearAllMocks() (which only clears call
      // history, not mockResolvedValue implementations) — without this, a truthy
      // value left behind by an unrelated test earlier in the run (e.g.
      // requestTierChange's "upgrade payment already in flight" case) can leak in
      // under randomized test ordering and silently steer linkInvoice into the
      // wrong branch.
      paymentModel.findPendingTierChangeBySubscriptionId.mockResolvedValue(null);
      paymentModel.findPendingRenewalBySubscriptionId.mockResolvedValue(null);
    });

    test('rejects when the subscription does not exist', async () => {
      subscriptionModel.findById.mockResolvedValue(null);

      await expect(subscriptionService.linkInvoice(10, accessKey))
        .rejects.toMatchObject({ statusCode: 404, code: 'SUBSCRIPTION_NOT_FOUND' });
    });

    test('rejects when the document does not exist', async () => {
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1 });
      documentModel.findByAccessKey.mockResolvedValue(null);

      await expect(subscriptionService.linkInvoice(10, accessKey))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    test('links the document (looked up by accessKey, no issuer scoping) and moves the subscription to INVOICE_PROCESSING', async () => {
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1 });
      documentModel.findByAccessKey.mockResolvedValue({ id: 999 });
      subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'INVOICE_PROCESSING' });

      const result = await subscriptionService.linkInvoice(10, accessKey);

      expect(documentModel.findByAccessKey).toHaveBeenCalledWith(accessKey);
      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(10, 'INVOICE_PROCESSING', { initial_invoice_document_id: 999 });
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'INVOICE_LINKED', { subscriptionId: 10, documentId: 999 });
      expect(result).toEqual({ id: 10, status: 'INVOICE_PROCESSING' });
    });

    test('activates immediately when the document being linked is already AUTHORIZED', async () => {
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER' });
      documentModel.findByAccessKey.mockResolvedValue({ id: 999, status: 'AUTHORIZED' });
      subscriptionModel.updateStatus
        .mockResolvedValueOnce({ id: 10, status: 'INVOICE_PROCESSING' }) // the link itself
        .mockResolvedValueOnce({ id: 10, status: 'ACTIVE' });           // inside activateIfLinked
      subscriptionModel.findByInitialInvoiceDocumentId.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'STARTER', status: 'INVOICE_PROCESSING', billing_interval: 'MONTHLY',
      });

      const result = await subscriptionService.linkInvoice(10, accessKey);

      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'STARTER');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith(1, 'STARTER');
      expect(result).toEqual({ id: 10, status: 'ACTIVE' });
    });

    test('links a VERIFIED TIER_CHANGE payment to its own invoice_document_id, leaving the subscription untouched', async () => {
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER' });
      documentModel.findByAccessKey.mockResolvedValue({ id: 999, status: 'RECEIVED' });
      paymentModel.findPendingTierChangeBySubscriptionId.mockResolvedValue({
        id: 30, subscription_id: 10, status: 'VERIFIED', target_tier: 'GROWTH',
      });

      const result = await subscriptionService.linkInvoice(10, accessKey);

      expect(paymentModel.updateStatus).toHaveBeenCalledWith(30, 'VERIFIED', { invoice_document_id: 999 });
      expect(subscriptionModel.updateStatus).not.toHaveBeenCalled();
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'INVOICE_LINKED', { subscriptionId: 10, paymentId: 30, documentId: 999 });
      expect(result).toEqual({ id: 10, tenant_id: 1, tier: 'STARTER' });
    });

    test('applies the tier change immediately when the linked TIER_CHANGE invoice is already AUTHORIZED', async () => {
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER' });
      documentModel.findByAccessKey.mockResolvedValue({ id: 999, status: 'AUTHORIZED' });
      paymentModel.findPendingTierChangeBySubscriptionId.mockResolvedValue({
        id: 30, subscription_id: 10, status: 'VERIFIED', target_tier: 'GROWTH',
      });
      paymentModel.findByInvoiceDocumentId.mockResolvedValue({
        id: 30, subscription_id: 10, purpose: 'TIER_CHANGE', status: 'VERIFIED', target_tier: 'GROWTH',
      });
      subscriptionModel.applyTierChange.mockResolvedValue({ id: 10, tier: 'GROWTH' });

      const result = await subscriptionService.linkInvoice(10, accessKey);

      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'GROWTH');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith(1, 'GROWTH');
      expect(result).toEqual({ id: 10, tier: 'GROWTH' });
    });

    test('links a VERIFIED RENEWAL payment to its own invoice_document_id, leaving the subscription untouched', async () => {
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER' });
      documentModel.findByAccessKey.mockResolvedValue({ id: 999, status: 'RECEIVED' });
      paymentModel.findPendingTierChangeBySubscriptionId.mockResolvedValue(null);
      paymentModel.findPendingRenewalBySubscriptionId.mockResolvedValue({
        id: 40, subscription_id: 10, status: 'VERIFIED',
      });

      const result = await subscriptionService.linkInvoice(10, accessKey);

      expect(paymentModel.updateStatus).toHaveBeenCalledWith(40, 'VERIFIED', { invoice_document_id: 999 });
      expect(subscriptionModel.updateStatus).not.toHaveBeenCalled();
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'INVOICE_LINKED', { subscriptionId: 10, paymentId: 40, documentId: 999 });
      expect(result).toEqual({ id: 10, tenant_id: 1, tier: 'STARTER' });
    });

    test('extends the period immediately when the linked RENEWAL invoice is already AUTHORIZED', async () => {
      const oldPeriodEnd = new Date('2026-07-01T00:00:00Z');
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER', billing_interval: 'MONTHLY', current_period_end: oldPeriodEnd });
      documentModel.findByAccessKey.mockResolvedValue({ id: 999, status: 'AUTHORIZED' });
      paymentModel.findPendingTierChangeBySubscriptionId.mockResolvedValue(null);
      paymentModel.findPendingRenewalBySubscriptionId.mockResolvedValue({
        id: 40, subscription_id: 10, status: 'VERIFIED',
      });
      paymentModel.findByInvoiceDocumentId.mockResolvedValue({
        id: 40, subscription_id: 10, purpose: 'RENEWAL', status: 'VERIFIED',
      });
      subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'ACTIVE' });

      const result = await subscriptionService.linkInvoice(10, accessKey);

      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(10, 'ACTIVE', {
        current_period_start: oldPeriodEnd,
        current_period_end: expect.any(Date),
      });
      expect(result).toEqual({ id: 10, status: 'ACTIVE' });
    });

    describe('sandbox documents', () => {
      test('a pending TIER_CHANGE payment applies immediately (correct target tier/interval), never touching invoice_document_id', async () => {
        const periodStart = new Date('2026-06-01T00:00:00Z');
        const periodEnd = new Date('2026-07-01T00:00:00Z');
        subscriptionModel.findById.mockResolvedValue({
          id: 10, tenant_id: 1, tier: 'STARTER', billing_interval: 'MONTHLY',
          current_period_start: periodStart, current_period_end: periodEnd,
        });
        documentModel.findByAccessKey.mockResolvedValue({ id: 999, status: 'AUTHORIZED', sandbox: true });
        paymentModel.findPendingTierChangeBySubscriptionId.mockResolvedValue({
          id: 30, subscription_id: 10, status: 'VERIFIED', target_tier: 'GROWTH', target_billing_interval: 'YEARLY',
        });
        subscriptionModel.applyTierChange.mockResolvedValue({ id: 10, tier: 'GROWTH', billing_interval: 'YEARLY' });

        const result = await subscriptionService.linkInvoice(10, accessKey);

        expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith(10, 'GROWTH', 'YEARLY');
        expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'GROWTH');
        expect(tenantQuotaService.setCap).toHaveBeenCalledWith(1, 'GROWTH');
        expect(paymentModel.updateStatus).toHaveBeenCalledWith(30, 'VERIFIED', {
          period_start: periodStart, period_end: periodEnd,
        });
        expect(paymentModel.updateStatus).not.toHaveBeenCalledWith(30, expect.anything(), expect.objectContaining({ invoice_document_id: expect.anything() }));
        expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGED', expect.objectContaining({
          subscriptionId: 10, fromTier: 'STARTER', toTier: 'GROWTH',
          fromBillingInterval: 'MONTHLY', toBillingInterval: 'YEARLY', paymentId: 30,
        }));
        expect(result).toEqual({ id: 10, tier: 'GROWTH', billing_interval: 'YEARLY' });
      });

      test('a pending RENEWAL payment extends the period immediately from the OLD current_period_end', async () => {
        const oldPeriodEnd = new Date('2026-07-01T00:00:00Z');
        subscriptionModel.findById.mockResolvedValue({
          id: 10, tenant_id: 1, tier: 'STARTER', billing_interval: 'MONTHLY', current_period_end: oldPeriodEnd,
        });
        documentModel.findByAccessKey.mockResolvedValue({ id: 999, status: 'AUTHORIZED', sandbox: true });
        paymentModel.findPendingTierChangeBySubscriptionId.mockResolvedValue(null);
        paymentModel.findPendingRenewalBySubscriptionId.mockResolvedValue({
          id: 40, subscription_id: 10, status: 'VERIFIED',
        });
        subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'ACTIVE' });

        const result = await subscriptionService.linkInvoice(10, accessKey);

        expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(10, 'ACTIVE', {
          current_period_start: oldPeriodEnd,
          current_period_end: expect.any(Date),
        });
        expect(paymentModel.updateStatus).toHaveBeenCalledWith(40, 'VERIFIED', {
          period_start: oldPeriodEnd, period_end: expect.any(Date),
        });
        expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'SUBSCRIPTION_RENEWED', expect.objectContaining({ subscriptionId: 10 }));
        expect(result).toEqual({ id: 10, status: 'ACTIVE' });
      });

      test('no pending TIER_CHANGE/RENEWAL: falls back to initial activation using the subscription\'s own tier', async () => {
        subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER', billing_interval: 'MONTHLY' });
        documentModel.findByAccessKey.mockResolvedValue({ id: 999, status: 'AUTHORIZED', sandbox: true });
        paymentModel.findPendingTierChangeBySubscriptionId.mockResolvedValue(null);
        paymentModel.findPendingRenewalBySubscriptionId.mockResolvedValue(null);
        subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'ACTIVE' });

        const result = await subscriptionService.linkInvoice(10, accessKey);

        expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'STARTER');
        expect(tenantQuotaService.setCap).toHaveBeenCalledWith(1, 'STARTER');
        expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'SUBSCRIPTION_ACTIVATED', expect.objectContaining({ subscriptionId: 10 }));
        expect(result).toEqual({ id: 10, status: 'ACTIVE' });
      });

      test('not yet AUTHORIZED: a pending TIER_CHANGE payment leaves the subscription untouched', async () => {
        subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER' });
        documentModel.findByAccessKey.mockResolvedValue({ id: 999, status: 'RECEIVED', sandbox: true });
        paymentModel.findPendingTierChangeBySubscriptionId.mockResolvedValue({
          id: 30, subscription_id: 10, status: 'VERIFIED', target_tier: 'GROWTH', target_billing_interval: null,
        });

        const result = await subscriptionService.linkInvoice(10, accessKey);

        expect(subscriptionModel.applyTierChange).not.toHaveBeenCalled();
        expect(subscriptionModel.updateStatus).not.toHaveBeenCalled();
        expect(result).toEqual({ id: 10, tenant_id: 1, tier: 'STARTER' });
      });

      test('not yet AUTHORIZED, no pending payment: moves to INVOICE_PROCESSING', async () => {
        subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER' });
        documentModel.findByAccessKey.mockResolvedValue({ id: 999, status: 'RECEIVED', sandbox: true });
        subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'INVOICE_PROCESSING' });

        const result = await subscriptionService.linkInvoice(10, accessKey);

        expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(10, 'INVOICE_PROCESSING', {});
        expect(result).toEqual({ id: 10, status: 'INVOICE_PROCESSING' });
      });
    });
  });

  describe('getStatusForTenant', () => {
    test('returns each subscription with its payments nested (proof files live behind the dedicated proofs endpoints, not inline here)', async () => {
      subscriptionModel.findByTenantId.mockResolvedValue([
        { id: 10, tenant_id: 1, tier: 'STARTER', status: 'INVOICE_PROCESSING' },
      ]);
      paymentModel.findBySubscriptionId.mockResolvedValue([
        { id: 20, status: 'REJECTED', rejection_reason_code: 'TRANSFER_NOT_FOUND' },
        { id: 21, status: 'VERIFIED' },
      ]);

      const result = await subscriptionService.getStatusForTenant(1);

      expect(subscriptionModel.findByTenantId).toHaveBeenCalledWith(1);
      expect(paymentModel.findBySubscriptionId).toHaveBeenCalledWith(10);
      expect(result).toEqual([
        {
          id: 10, tenant_id: 1, tier: 'STARTER', status: 'INVOICE_PROCESSING',
          payments: [
            { id: 20, status: 'REJECTED', rejection_reason_code: 'TRANSFER_NOT_FOUND' },
            { id: 21, status: 'VERIFIED' },
          ],
        },
      ]);
    });

    test('returns an empty array for a tenant who never subscribed', async () => {
      subscriptionModel.findByTenantId.mockResolvedValue([]);

      const result = await subscriptionService.getStatusForTenant(1);

      expect(result).toEqual([]);
      expect(paymentModel.findBySubscriptionId).not.toHaveBeenCalled();
    });
  });
});
