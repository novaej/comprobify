jest.mock('../../../src/models/subscription.model');
jest.mock('../../../src/models/payment.model');
jest.mock('../../../src/models/payment-proof.model');
jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/tenant.model');
jest.mock('../../../src/models/tenant-event.model');
jest.mock('../../../src/services/tenant-quota.service');
jest.mock('../../../src/services/pending-effect.service');
jest.mock('../../../src/services/pricing.service');
jest.mock('../../../src/services/notification.service');

const subscriptionModel = require('../../../src/models/subscription.model');
const paymentModel = require('../../../src/models/payment.model');
const paymentProofModel = require('../../../src/models/payment-proof.model');
const documentModel = require('../../../src/models/document.model');
const tenantModel = require('../../../src/models/tenant.model');
const tenantEventModel = require('../../../src/models/tenant-event.model');
const tenantQuotaService = require('../../../src/services/tenant-quota.service');
const pendingEffectService = require('../../../src/services/pending-effect.service');
const pricingService = require('../../../src/services/pricing.service');
const notificationService = require('../../../src/services/notification.service');
const config = require('../../../src/config');
const subscriptionService = require('../../../src/services/subscription.service');

// Same figures the old TIERS[tier].priceMonthlyUsd/priceYearlyUsd constants
// used to carry, now served by a mocked pricingService — every test below
// that doesn't care about price history keeps working against these fixed
// values regardless of asOfDate. Tests that DO care about date-based
// resolution (the 30-day protection) override getPriceAsOf per-call instead.
const PRICES = {
  FREE:     { MONTHLY: 0,   YEARLY: 0 },
  STARTER:  { MONTHLY: 20,  YEARLY: 200 },
  GROWTH:   { MONTHLY: 90,  YEARLY: 900 },
  BUSINESS: { MONTHLY: 230, YEARLY: 2300 },
};

describe('SubscriptionService', () => {
  beforeEach(() => {
    pendingEffectService.enqueue.mockResolvedValue({ id: 'effect-x', effect_type: 'X' });
    pendingEffectService.dispatch.mockResolvedValue();
    pricingService.getCurrentPrice.mockImplementation(async (tier, interval) => PRICES[tier][interval]);
    pricingService.getPriceAsOf.mockImplementation(async (tier, interval) => PRICES[tier][interval]);
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
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveOrPendingByTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000005', status: 'PENDING_PAYMENT' });

      await expect(subscriptionService.createSubscription(1, 'STARTER'))
        .rejects.toMatchObject({ statusCode: 409, code: 'SUBSCRIPTION_ALREADY_IN_FLIGHT' });
      expect(subscriptionModel.create).not.toHaveBeenCalled();
    });

    test('creates a subscription and a payment priced from the tier (default MONTHLY), and logs an event', async () => {
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveOrPendingByTenantId.mockResolvedValue(null);
      subscriptionModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER' });
      paymentModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010', amount: 17.39, iva_rate: 0.15, iva_amount: 2.61, total_amount: 20 });

      const result = await subscriptionService.createSubscription(1, 'STARTER');

      expect(subscriptionModel.create).toHaveBeenCalledWith({ tenantId: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', billingInterval: 'MONTHLY' });
      expect(paymentModel.create).toHaveBeenCalledWith({ subscriptionId: '00000000-0000-0000-0000-000000000010', amount: 17.39, ivaRate: 0.15, ivaAmount: 2.61, totalAmount: 20 });
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'SUBSCRIPTION_CREATED', { subscriptionId: '00000000-0000-0000-0000-000000000010', tier: 'STARTER', billingInterval: 'MONTHLY' });
      expect(result).toEqual({
        subscription: { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER' },
        payment: { id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010', amount: 17.39, iva_rate: 0.15, iva_amount: 2.61, total_amount: 20 },
        bankTransfer: config.bankTransfer,
      });
    });

    test('prices from priceYearlyUsd and stores billing_interval when YEARLY is requested', async () => {
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveOrPendingByTenantId.mockResolvedValue(null);
      subscriptionModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', billing_interval: 'YEARLY' });
      paymentModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010', amount: 173.91, iva_rate: 0.15, iva_amount: 26.09, total_amount: 200 });

      await subscriptionService.createSubscription(1, 'STARTER', 'YEARLY');

      expect(subscriptionModel.create).toHaveBeenCalledWith({ tenantId: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', billingInterval: 'YEARLY' });
      expect(paymentModel.create).toHaveBeenCalledWith({ subscriptionId: '00000000-0000-0000-0000-000000000010', amount: 173.91, ivaRate: 0.15, ivaAmount: 26.09, totalAmount: 200 });
    });
  });

  describe('createSubscriptionForTenant', () => {
    test('rejects when the tenant does not exist', async () => {
      tenantModel.findById.mockResolvedValue(null);

      await expect(subscriptionService.createSubscriptionForTenant(1, 'STARTER'))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    test('rejects when the tenant has not verified their email', async () => {
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', status: 'PENDING_VERIFICATION' });

      await expect(subscriptionService.createSubscriptionForTenant(1, 'STARTER'))
        .rejects.toMatchObject({ statusCode: 403, code: 'EMAIL_VERIFICATION_REQUIRED' });
      expect(subscriptionModel.create).not.toHaveBeenCalled();
    });

    test('creates the subscription when the tenant is ACTIVE, regardless of sandbox status', async () => {
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE', sandbox: true });
      subscriptionModel.findActiveOrPendingByTenantId.mockResolvedValue(null);
      subscriptionModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER' });
      paymentModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010', amount: 19 });

      const result = await subscriptionService.createSubscriptionForTenant(1, 'STARTER');

      expect(subscriptionModel.create).toHaveBeenCalledWith({ tenantId: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', billingInterval: 'MONTHLY' });
      expect(result.subscription).toEqual({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER' });
    });

    // PAST_DUE is deliberately allowed through — this is the self-service
    // recovery path back to ACTIVE (see docs/adr/025-past-due-tenant-status.md).
    // SUSPENDED is never exercised here since requireNotSuspended already
    // blocks the route before this service function ever runs.
    test('creates the subscription when the tenant is PAST_DUE (self-service recovery)', async () => {
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', status: 'PAST_DUE', sandbox: false });
      subscriptionModel.findActiveOrPendingByTenantId.mockResolvedValue(null);
      subscriptionModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER' });
      paymentModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010', amount: 19 });

      const result = await subscriptionService.createSubscriptionForTenant(1, 'STARTER');

      expect(subscriptionModel.create).toHaveBeenCalledWith({ tenantId: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', billingInterval: 'MONTHLY' });
      expect(result.subscription).toEqual({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER' });
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
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveByTenantId.mockResolvedValue(null);

      await expect(subscriptionService.requestTierChange(1, 'GROWTH'))
        .rejects.toMatchObject({ statusCode: 409, code: 'NO_ACTIVE_SUBSCRIPTION' });
    });

    test('rejects when the requested tier matches the current tier', async () => {
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tier: 'GROWTH' });

      await expect(subscriptionService.requestTierChange(1, 'GROWTH'))
        .rejects.toMatchObject({ statusCode: 400, code: 'TIER_CHANGE_NO_OP' });
    });

    test('rejects when a downgrade is already scheduled', async () => {
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tier: 'GROWTH', pending_tier: 'STARTER' });

      await expect(subscriptionService.requestTierChange(1, 'BUSINESS'))
        .rejects.toMatchObject({ statusCode: 409, code: 'TIER_CHANGE_ALREADY_PENDING' });
    });

    test('rejects when an upgrade payment is already in flight', async () => {
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tier: 'GROWTH', pending_tier: null });
      paymentModel.findPendingTierChangeBySubscriptionId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000030', target_tier: 'BUSINESS' });

      await expect(subscriptionService.requestTierChange(1, 'BUSINESS'))
        .rejects.toMatchObject({ statusCode: 409, code: 'TIER_CHANGE_ALREADY_PENDING' });
    });

    test('downgrade: schedules pending_tier, creates no payment, logs TIER_CHANGE_SCHEDULED', async () => {
      const periodEnd = new Date('2026-07-01T00:00:00Z');
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'GROWTH', pending_tier: null, current_period_end: periodEnd,
      });
      subscriptionModel.scheduleDowngrade.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tier: 'GROWTH', pending_tier: 'STARTER' });

      const result = await subscriptionService.requestTierChange(1, 'STARTER');

      expect(subscriptionModel.scheduleDowngrade).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010', 'STARTER');
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'TIER_CHANGE_SCHEDULED', {
        subscriptionId: '00000000-0000-0000-0000-000000000010', fromTier: 'GROWTH', toTier: 'STARTER', effectiveAt: periodEnd,
      });
      expect(result).toEqual({
        subscription: { id: '00000000-0000-0000-0000-000000000010', tier: 'GROWTH', pending_tier: 'STARTER' },
        effectiveAt: periodEnd,
      });
    });

    test('upgrade: prorates the price difference by remaining period time, creates a TIER_CHANGE payment', async () => {
      const now = Date.now();
      const periodStart = new Date(now - 15 * 24 * 60 * 60 * 1000); // 15 days ago
      const periodEnd = new Date(now + 15 * 24 * 60 * 60 * 1000);   // 15 days from now (~50% remaining, 30-day period)
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', pending_tier: null,
        billing_interval: 'MONTHLY', current_period_start: periodStart, current_period_end: periodEnd,
      });
      paymentModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000030', subscription_id: '00000000-0000-0000-0000-000000000010', amount: 30, purpose: 'TIER_CHANGE', target_tier: 'GROWTH' });

      const result = await subscriptionService.requestTierChange(1, 'GROWTH');

      // GROWTH (90) - STARTER (20) = 70 gross, ~50% of the period remains -> ~35
      // gross, split at the current 15% IVA rate into a ~30.43 base + ~4.57 IVA.
      const [createArgs] = paymentModel.create.mock.calls[0];
      expect(createArgs.subscriptionId).toBe('00000000-0000-0000-0000-000000000010');
      expect(createArgs.purpose).toBe('TIER_CHANGE');
      expect(createArgs.targetTier).toBe('GROWTH');
      expect(createArgs.amount).toBeCloseTo(30, 0);
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'TIER_CHANGE_REQUESTED', expect.objectContaining({
        subscriptionId: '00000000-0000-0000-0000-000000000010', fromTier: 'STARTER', toTier: 'GROWTH',
      }));
      expect(result).toEqual({
        subscription: expect.objectContaining({ id: '00000000-0000-0000-0000-000000000010' }),
        payment: { id: '00000000-0000-0000-0000-000000000030', subscription_id: '00000000-0000-0000-0000-000000000010', amount: 30, purpose: 'TIER_CHANGE', target_tier: 'GROWTH' },
        bankTransfer: config.bankTransfer,
      });
    });

    test('upgrade: applies immediately with no payment when the prorated amount rounds to $0', async () => {
      const now = Date.now();
      const periodEnd = new Date(now - 1000); // already ended -> 0% remaining
      const periodStart = new Date(now - 30 * 24 * 60 * 60 * 1000);
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', pending_tier: null,
        billing_interval: 'MONTHLY', current_period_start: periodStart, current_period_end: periodEnd,
      });
      subscriptionModel.applyTierChange.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tier: 'GROWTH' });

      const result = await subscriptionService.requestTierChange(1, 'GROWTH');

      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010', 'GROWTH');
      expect(tenantModel.updateTier).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'GROWTH');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'GROWTH');
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'TIER_CHANGED', {
        subscriptionId: '00000000-0000-0000-0000-000000000010', fromTier: 'STARTER', toTier: 'GROWTH', totalAmount: 0,
      });
      expect(result).toEqual({ subscription: { id: '00000000-0000-0000-0000-000000000010', tier: 'GROWTH' }, payment: null, amount: 0 });
    });

    test('rejects an invalid billingInterval', async () => {
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tier: 'GROWTH', billing_interval: 'MONTHLY' });

      await expect(subscriptionService.requestTierChange(1, 'GROWTH', 'WEEKLY'))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_BILLING_INTERVAL' });
      expect(paymentModel.create).not.toHaveBeenCalled();
    });

    test('rejects when tier and billingInterval both match the current subscription', async () => {
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tier: 'GROWTH', billing_interval: 'MONTHLY' });

      await expect(subscriptionService.requestTierChange(1, 'GROWTH', 'MONTHLY'))
        .rejects.toMatchObject({ statusCode: 400, code: 'TIER_CHANGE_NO_OP' });
    });

    test('interval-only change (same tier): deferred, full price, no proration', async () => {
      const periodEnd = new Date('2026-08-01T00:00:00Z');
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'GROWTH', pending_tier: null,
        billing_interval: 'MONTHLY', current_period_end: periodEnd,
      });
      paymentModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000040', subscription_id: '00000000-0000-0000-0000-000000000010', purpose: 'TIER_CHANGE', target_tier: 'GROWTH', target_billing_interval: 'YEARLY' });

      const result = await subscriptionService.requestTierChange(1, 'GROWTH', 'YEARLY');

      const [createArgs] = paymentModel.create.mock.calls[0];
      expect(createArgs.subscriptionId).toBe('00000000-0000-0000-0000-000000000010');
      expect(createArgs.purpose).toBe('TIER_CHANGE');
      expect(createArgs.targetTier).toBe('GROWTH');
      expect(createArgs.targetBillingInterval).toBe('YEARLY');
      // Full yearly-GROWTH sticker price (900), not prorated against the
      // remaining monthly period.
      expect(createArgs.totalAmount).toBe(900);
      // Priced as of current_period_end (when the new cadence's period
      // actually starts), not "now" — the 30-day protection applies here too.
      expect(pricingService.getPriceAsOf).toHaveBeenCalledWith('GROWTH', 'YEARLY', periodEnd);
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'TIER_CHANGE_REQUESTED', expect.objectContaining({
        subscriptionId: '00000000-0000-0000-0000-000000000010', fromTier: 'GROWTH', toTier: 'GROWTH',
        fromBillingInterval: 'MONTHLY', toBillingInterval: 'YEARLY', effectiveAt: periodEnd,
      }));
      expect(result).toEqual({
        subscription: expect.objectContaining({ id: '00000000-0000-0000-0000-000000000010' }),
        payment: { id: '00000000-0000-0000-0000-000000000040', subscription_id: '00000000-0000-0000-0000-000000000010', purpose: 'TIER_CHANGE', target_tier: 'GROWTH', target_billing_interval: 'YEARLY' },
        bankTransfer: config.bankTransfer,
        effectiveAt: periodEnd,
      });
    });

    test('tier upgrade + interval change: deferred (not the immediate prorated path)', async () => {
      const now = Date.now();
      const periodStart = new Date(now - 15 * 24 * 60 * 60 * 1000);
      const periodEnd = new Date(now + 15 * 24 * 60 * 60 * 1000);
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', pending_tier: null,
        billing_interval: 'MONTHLY', current_period_start: periodStart, current_period_end: periodEnd,
      });
      paymentModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000041', subscription_id: '00000000-0000-0000-0000-000000000010', purpose: 'TIER_CHANGE', target_tier: 'GROWTH', target_billing_interval: 'YEARLY' });

      await subscriptionService.requestTierChange(1, 'GROWTH', 'YEARLY');

      expect(subscriptionModel.applyTierChange).not.toHaveBeenCalled();
      const [createArgs] = paymentModel.create.mock.calls[0];
      expect(createArgs.targetBillingInterval).toBe('YEARLY');
      expect(createArgs.totalAmount).toBe(900); // full yearly-GROWTH price, not prorated
    });

    test('tier downgrade + interval change: deferred and paid (unlike a plain same-interval downgrade)', async () => {
      const periodEnd = new Date('2026-08-01T00:00:00Z');
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
      subscriptionModel.findActiveByTenantId.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'GROWTH', pending_tier: null,
        billing_interval: 'MONTHLY', current_period_end: periodEnd,
      });
      paymentModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000042', subscription_id: '00000000-0000-0000-0000-000000000010', purpose: 'TIER_CHANGE', target_tier: 'STARTER', target_billing_interval: 'YEARLY' });

      const result = await subscriptionService.requestTierChange(1, 'STARTER', 'YEARLY');

      expect(subscriptionModel.scheduleDowngrade).not.toHaveBeenCalled();
      const [createArgs] = paymentModel.create.mock.calls[0];
      expect(createArgs.targetTier).toBe('STARTER');
      expect(createArgs.targetBillingInterval).toBe('YEARLY');
      expect(createArgs.totalAmount).toBe(200); // full yearly-STARTER price
      expect(result.subscription).toEqual(expect.objectContaining({ id: '00000000-0000-0000-0000-000000000010', tier: 'GROWTH' }));
    });

    describe('sandbox tenant', () => {
      test('downgrade applies immediately, free, no payment created', async () => {
        tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', sandbox: true });
        subscriptionModel.findActiveByTenantId.mockResolvedValue({
          id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'GROWTH', pending_tier: null, billing_interval: 'MONTHLY',
        });
        subscriptionModel.applyTierChange.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tier: 'STARTER' });

        const result = await subscriptionService.requestTierChange(1, 'STARTER');

        expect(subscriptionModel.scheduleDowngrade).not.toHaveBeenCalled();
        expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010', 'STARTER', 'MONTHLY');
        expect(tenantModel.updateTier).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'STARTER');
        expect(tenantQuotaService.setCap).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'STARTER');
        expect(paymentModel.create).not.toHaveBeenCalled();
        expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'TIER_CHANGED', expect.objectContaining({
          subscriptionId: '00000000-0000-0000-0000-000000000010', fromTier: 'GROWTH', toTier: 'STARTER', totalAmount: 0,
        }));
        expect(result).toEqual({ subscription: { id: '00000000-0000-0000-0000-000000000010', tier: 'STARTER' }, payment: null, amount: 0 });
      });

      test('same-interval upgrade charges the difference, not the full sticker price', async () => {
        const now = Date.now();
        tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', sandbox: true });
        subscriptionModel.findActiveByTenantId.mockResolvedValue({
          id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', pending_tier: null, billing_interval: 'MONTHLY',
          current_period_start: new Date(now - 15 * 24 * 60 * 60 * 1000),
          current_period_end: new Date(now + 15 * 24 * 60 * 60 * 1000), // ~50% remaining — would prorate to ~30 in production
        });
        paymentModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000050', subscription_id: '00000000-0000-0000-0000-000000000010', purpose: 'TIER_CHANGE', target_tier: 'GROWTH' });

        const result = await subscriptionService.requestTierChange(1, 'GROWTH');

        const [createArgs] = paymentModel.create.mock.calls[0];
        expect(createArgs.targetTier).toBe('GROWTH');
        expect(createArgs.targetBillingInterval).toBe('MONTHLY');
        // GROWTH $90 - STARTER $20 already paid = $70. Not prorated by the
        // ~50% remaining (sandbox has no real period), but not $90 either.
        expect(createArgs.totalAmount).toBe(70);
        expect(subscriptionModel.applyTierChange).not.toHaveBeenCalled();
        expect(result).toEqual({ subscription: expect.objectContaining({ id: '00000000-0000-0000-0000-000000000010' }), payment: expect.objectContaining({ id: '00000000-0000-0000-0000-000000000050' }), bankTransfer: config.bankTransfer });
      });

      test('interval-changing upgrade also credits the previously paid tier', async () => {
        tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', sandbox: true });
        subscriptionModel.findActiveByTenantId.mockResolvedValue({
          id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', pending_tier: null, billing_interval: 'MONTHLY',
        });
        paymentModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000051', subscription_id: '00000000-0000-0000-0000-000000000010', purpose: 'TIER_CHANGE', target_tier: 'GROWTH', target_billing_interval: 'YEARLY' });

        await subscriptionService.requestTierChange(1, 'GROWTH', 'YEARLY');

        const [createArgs] = paymentModel.create.mock.calls[0];
        expect(createArgs.targetTier).toBe('GROWTH');
        expect(createArgs.targetBillingInterval).toBe('YEARLY');
        expect(createArgs.totalAmount).toBe(880); // yearly GROWTH $900 - monthly STARTER $20
      });
    });
  });

  // Replaces the old activateIfLinked/applyTierChangeIfLinked/
  // applyRenewalIfLinked trio: since ADR-027 a verified payment is applied at
  // verification time, not when its invoice authorizes.
  describe('applyVerifiedPayment', () => {
    const TENANT = '00000000-0000-0000-0000-000000000001';
    const SUB = '00000000-0000-0000-0000-000000000010';
    const PAY = '00000000-0000-0000-0000-000000000020';

    beforeEach(() => {
      tenantModel.findById.mockResolvedValue({ id: TENANT, status: 'ACTIVE', subscription_tier: 'FREE' });
      subscriptionModel.updateStatus.mockResolvedValue({ id: SUB, status: 'ACTIVE' });
      subscriptionModel.applyTierChange.mockResolvedValue({ id: SUB, tier: 'GROWTH' });
      subscriptionModel.scheduleDowngrade.mockResolvedValue({ id: SUB, pending_tier: 'STARTER' });
    });

    // The snapshot is what makes refundPayment able to restore the right prior
    // state, so it must be written before anything is changed.
    test('records a rollback snapshot of the pre-change state on the payment', async () => {
      const payment = { id: PAY, purpose: 'INITIAL', status: 'VERIFIED' };
      const subscription = {
        id: SUB, tenant_id: TENANT, tier: 'STARTER', billing_interval: 'MONTHLY',
        status: 'PENDING_PAYMENT', current_period_start: null, current_period_end: null,
      };

      await subscriptionService.applyVerifiedPayment(payment, subscription);

      expect(paymentModel.updateStatus).toHaveBeenCalledWith(PAY, 'VERIFIED', {
        applied_from: {
          tier: 'STARTER',
          billingInterval: 'MONTHLY',
          periodStart: null,
          periodEnd: null,
          subscriptionStatus: 'PENDING_PAYMENT',
          // The tenant's tier, not the subscription's — an INITIAL payment's
          // subscription already reads STARTER while the tenant is still FREE.
          tenantTier: 'FREE',
        },
      });
    });

    describe('INITIAL', () => {
      const payment = { id: PAY, purpose: 'INITIAL', status: 'VERIFIED' };

      test('activates the subscription and grants the tier (MONTHLY, +1 month)', async () => {
        const subscription = {
          id: SUB, tenant_id: TENANT, tier: 'STARTER', billing_interval: 'MONTHLY', status: 'PENDING_PAYMENT',
        };

        const result = await subscriptionService.applyVerifiedPayment(payment, subscription);

        const [, status, fields] = subscriptionModel.updateStatus.mock.calls[0];
        expect(status).toBe('ACTIVE');
        const months = (fields.current_period_end.getFullYear() - fields.current_period_start.getFullYear()) * 12
          + (fields.current_period_end.getMonth() - fields.current_period_start.getMonth());
        expect(months).toBe(1);

        expect(tenantModel.updateTier).toHaveBeenCalledWith(TENANT, 'STARTER');
        expect(tenantQuotaService.setCap).toHaveBeenCalledWith(TENANT, 'STARTER');
        expect(tenantEventModel.create).toHaveBeenCalledWith(TENANT, 'SUBSCRIPTION_ACTIVATED', {
          subscriptionId: SUB, tier: 'STARTER', paymentId: PAY,
        });
        expect(result).toEqual({ id: SUB, status: 'ACTIVE' });
      });

      test('uses a +1 year period when billing_interval is YEARLY', async () => {
        await subscriptionService.applyVerifiedPayment(payment, {
          id: SUB, tenant_id: TENANT, tier: 'STARTER', billing_interval: 'YEARLY', status: 'PENDING_PAYMENT',
        });

        const fields = subscriptionModel.updateStatus.mock.calls[0][2];
        expect(fields.current_period_end.getFullYear() - fields.current_period_start.getFullYear()).toBe(1);
      });

      // Per-cycle history: the subscription's own period columns are
      // overwritten every renewal, so the funding payment carries its own copy.
      test('stamps period_start/period_end onto the funding payment', async () => {
        await subscriptionService.applyVerifiedPayment(payment, {
          id: SUB, tenant_id: TENANT, tier: 'STARTER', billing_interval: 'MONTHLY', status: 'PENDING_PAYMENT',
        });

        expect(paymentModel.updateStatus).toHaveBeenCalledWith(PAY, 'VERIFIED', {
          period_start: expect.any(Date), period_end: expect.any(Date),
        });
      });

      test('flips a PAST_DUE tenant back to ACTIVE and logs STATUS_CHANGED', async () => {
        tenantModel.findById.mockResolvedValue({ id: TENANT, status: 'PAST_DUE', subscription_tier: 'FREE' });
        pricingService.notifyPendingPriceChangesForTenant.mockResolvedValue();

        await subscriptionService.applyVerifiedPayment(payment, {
          id: SUB, tenant_id: TENANT, tier: 'STARTER', billing_interval: 'MONTHLY', status: 'PENDING_PAYMENT',
        });

        expect(tenantModel.updateStatus).toHaveBeenCalledWith(TENANT, 'ACTIVE');
        expect(tenantEventModel.create).toHaveBeenCalledWith(TENANT, 'STATUS_CHANGED', {
          from: 'PAST_DUE', to: 'ACTIVE', reason: 'payment_recovered',
        });
      });

      test('does not touch tenants.status when the tenant is already ACTIVE', async () => {
        await subscriptionService.applyVerifiedPayment(payment, {
          id: SUB, tenant_id: TENANT, tier: 'STARTER', billing_interval: 'MONTHLY', status: 'PENDING_PAYMENT',
        });

        expect(tenantModel.updateStatus).not.toHaveBeenCalled();
      });

      test('does not fail activation if the price-change catch-up notification throws', async () => {
        tenantModel.findById.mockResolvedValue({ id: TENANT, status: 'PAST_DUE', subscription_tier: 'FREE' });
        pricingService.notifyPendingPriceChangesForTenant.mockRejectedValue(new Error('boom'));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(subscriptionService.applyVerifiedPayment(payment, {
          id: SUB, tenant_id: TENANT, tier: 'STARTER', billing_interval: 'MONTHLY', status: 'PENDING_PAYMENT',
        })).resolves.toBeTruthy();

        console.error.mockRestore();
      });
    });

    describe('TIER_CHANGE', () => {
      const subscription = {
        id: SUB, tenant_id: TENANT, tier: 'STARTER', billing_interval: 'MONTHLY', status: 'ACTIVE',
        current_period_start: new Date('2026-03-01'), current_period_end: new Date('2026-04-01'),
      };

      test('flips the tier, grants the new quota, stamps the payment period, and logs TIER_CHANGED', async () => {
        const payment = { id: PAY, purpose: 'TIER_CHANGE', status: 'VERIFIED', target_tier: 'GROWTH', target_billing_interval: null };

        await subscriptionService.applyVerifiedPayment(payment, subscription);

        expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith(SUB, 'GROWTH', null);
        expect(tenantModel.updateTier).toHaveBeenCalledWith(TENANT, 'GROWTH');
        expect(tenantQuotaService.setCap).toHaveBeenCalledWith(TENANT, 'GROWTH');
        // The upgrade takes over the remainder of the SAME cycle — period unchanged.
        expect(paymentModel.updateStatus).toHaveBeenCalledWith(PAY, 'VERIFIED', {
          period_start: subscription.current_period_start,
          period_end: subscription.current_period_end,
        });
        expect(tenantEventModel.create).toHaveBeenCalledWith(TENANT, 'TIER_CHANGED', {
          subscriptionId: SUB, fromTier: 'STARTER', toTier: 'GROWTH', paymentId: PAY,
          fromBillingInterval: 'MONTHLY', toBillingInterval: 'MONTHLY',
        });
      });

      test('a production interval change is scheduled for period-end, not applied now', async () => {
        tenantModel.findById.mockResolvedValue({ id: TENANT, status: 'ACTIVE', subscription_tier: 'STARTER', sandbox: false });
        const payment = { id: PAY, purpose: 'TIER_CHANGE', status: 'VERIFIED', target_tier: 'GROWTH', target_billing_interval: 'YEARLY' };

        await subscriptionService.applyVerifiedPayment(payment, subscription);

        expect(subscriptionModel.scheduleDowngrade).toHaveBeenCalledWith(SUB, 'GROWTH', 'YEARLY');
        expect(subscriptionModel.applyTierChange).not.toHaveBeenCalled();
        expect(tenantModel.updateTier).not.toHaveBeenCalled();
        expect(tenantEventModel.create).toHaveBeenCalledWith(TENANT, 'TIER_CHANGE_SCHEDULED', expect.objectContaining({
          toTier: 'GROWTH', toBillingInterval: 'YEARLY', effectiveAt: subscription.current_period_end,
        }));
      });

      // The sandbox bug: targetInterval is never null (it falls back to the
      // subscription's own), so every sandbox change carried
      // target_billing_interval and got deferred to a period_end that
      // promotion then discards — the tenant paid and the tier never flipped.
      test('a sandbox change applies immediately instead of being scheduled', async () => {
        tenantModel.findById.mockResolvedValue({ id: TENANT, status: 'ACTIVE', subscription_tier: 'STARTER', sandbox: true });
        const payment = { id: PAY, purpose: 'TIER_CHANGE', status: 'VERIFIED', target_tier: 'GROWTH', target_billing_interval: 'MONTHLY' };

        await subscriptionService.applyVerifiedPayment(payment, subscription);

        expect(subscriptionModel.scheduleDowngrade).not.toHaveBeenCalled();
        expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith(SUB, 'GROWTH', 'MONTHLY');
        expect(tenantModel.updateTier).toHaveBeenCalledWith(TENANT, 'GROWTH');
      });

      test('a sandbox interval change carries the new interval through, not just the tier', async () => {
        tenantModel.findById.mockResolvedValue({ id: TENANT, status: 'ACTIVE', subscription_tier: 'STARTER', sandbox: true });
        const payment = { id: PAY, purpose: 'TIER_CHANGE', status: 'VERIFIED', target_tier: 'GROWTH', target_billing_interval: 'YEARLY' };

        await subscriptionService.applyVerifiedPayment(payment, subscription);

        expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith(SUB, 'GROWTH', 'YEARLY');
      });

      // period_start is what marks a TIER_CHANGE payment as still-unapplied
      // (findPendingTierChangeBySubscriptionId); applyScheduledTierChanges
      // stamps it when the deferred change actually lands.
      test('a deferred change leaves period_start unstamped', async () => {
        const payment = { id: PAY, purpose: 'TIER_CHANGE', status: 'VERIFIED', target_tier: 'GROWTH', target_billing_interval: 'YEARLY' };

        await subscriptionService.applyVerifiedPayment(payment, subscription);

        const periodStamps = paymentModel.updateStatus.mock.calls.filter(([, , f]) => f && 'period_start' in f);
        expect(periodStamps).toHaveLength(0);
      });
    });

    describe('RENEWAL', () => {
      test('extends the period from the OLD current_period_end and logs SUBSCRIPTION_RENEWED', async () => {
        const payment = { id: PAY, purpose: 'RENEWAL', status: 'VERIFIED' };
        const subscription = {
          id: SUB, tenant_id: TENANT, tier: 'GROWTH', billing_interval: 'MONTHLY', status: 'ACTIVE',
          current_period_start: new Date('2026-03-15T12:00:00Z'),
          current_period_end: new Date('2026-04-15T12:00:00Z'),
        };

        await subscriptionService.applyVerifiedPayment(payment, subscription);

        const fields = subscriptionModel.updateStatus.mock.calls[0][2];
        // Anchored to the old period end, NOT "now" — an early or late review
        // must not drift the billing date.
        expect(fields.current_period_start).toEqual(new Date('2026-04-15T12:00:00Z'));
        expect(fields.current_period_end).toEqual(new Date('2026-05-15T12:00:00Z'));
        expect(tenantEventModel.create).toHaveBeenCalledWith(TENANT, 'SUBSCRIPTION_RENEWED', expect.objectContaining({
          subscriptionId: SUB, tier: 'GROWTH', paymentId: PAY,
        }));
        // A renewal never changes tier.
        expect(tenantModel.updateTier).not.toHaveBeenCalled();
      });

      // Regression: addBillingPeriod used to overflow a month-end anchor
      // (Jan 31 + 1 month = "Feb 31" = Mar 3), handing the customer a free
      // extra month and permanently shifting the anniversary, since the next
      // renewal anchors to this already-drifted date. See src/utils/add-months.js.
      test('a period ending on a 31st clamps to month-end instead of overflowing', async () => {
        const payment = { id: PAY, purpose: 'RENEWAL', status: 'VERIFIED' };

        await subscriptionService.applyVerifiedPayment(payment, {
          id: SUB, tenant_id: TENANT, tier: 'GROWTH', billing_interval: 'MONTHLY', status: 'ACTIVE',
          current_period_start: new Date('2025-12-31T12:00:00Z'),
          current_period_end: new Date('2026-01-31T12:00:00Z'),
        });

        const fields = subscriptionModel.updateStatus.mock.calls[0][2];
        expect(fields.current_period_end).toEqual(new Date('2026-02-28T12:00:00Z'));
      });
    });
  });

  describe('applyScheduledTierChanges', () => {
    test('applies every due downgrade, rolls the period forward, and reports the count', async () => {
      const periodEnd1 = new Date('2026-06-15T00:00:00Z');
      const periodEnd2 = new Date('2026-06-20T00:00:00Z');
      subscriptionModel.findDuePendingDowngrades.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'GROWTH', pending_tier: 'STARTER', pending_billing_interval: null, billing_interval: 'MONTHLY', current_period_end: periodEnd1 },
        { id: '00000000-0000-0000-0000-000000000011', tenant_id: '00000000-0000-0000-0000-000000000002', tier: 'BUSINESS', pending_tier: 'GROWTH', pending_billing_interval: null, billing_interval: 'YEARLY', current_period_end: periodEnd2 },
      ]);

      const result = await subscriptionService.applyScheduledTierChanges();

      expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010', 'STARTER', null);
      expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000011', 'GROWTH', null);
      expect(tenantModel.updateTier).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'STARTER');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'STARTER');
      expect(tenantModel.updateTier).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000002', 'GROWTH');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000002', 'GROWTH');
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'TIER_CHANGED', {
        subscriptionId: '00000000-0000-0000-0000-000000000010', fromTier: 'GROWTH', toTier: 'STARTER', fromBillingInterval: 'MONTHLY', toBillingInterval: 'MONTHLY',
      });

      // Rolled forward from the OLD current_period_end, not "now" — +1 month for
      // subscription 10 (MONTHLY), +1 year for subscription 11 (YEARLY).
      const call10 = subscriptionModel.updateStatus.mock.calls.find((c) => c[0] === '00000000-0000-0000-0000-000000000010');
      expect(call10[1]).toBe('ACTIVE');
      expect(call10[2].current_period_start).toEqual(periodEnd1);
      expect(call10[2].current_period_end.getMonth()).toBe((periodEnd1.getMonth() + 1) % 12);

      const call11 = subscriptionModel.updateStatus.mock.calls.find((c) => c[0] === '00000000-0000-0000-0000-000000000011');
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
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'GROWTH', pending_tier: 'STARTER', pending_billing_interval: 'YEARLY', billing_interval: 'MONTHLY', current_period_end: periodEnd },
      ]);
      paymentModel.findBySubscriptionId.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000050', purpose: 'TIER_CHANGE', status: 'VERIFIED', invoice_document_id: '00000000-0000-0000-0000-000000000900', period_start: null },
      ]);

      const result = await subscriptionService.applyScheduledTierChanges();

      expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010', 'STARTER', 'YEARLY');

      const call10 = subscriptionModel.updateStatus.mock.calls.find((c) => c[0] === '00000000-0000-0000-0000-000000000010');
      expect(call10[2].current_period_start).toEqual(periodEnd);
      // Rolled forward using the NEW (YEARLY) interval, not the old MONTHLY one.
      expect(call10[2].current_period_end.getFullYear()).toBe(periodEnd.getFullYear() + 1);

      expect(paymentModel.updateStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000050', 'VERIFIED', {
        period_start: call10[2].current_period_start,
        period_end: call10[2].current_period_end,
      });
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'TIER_CHANGED', {
        subscriptionId: '00000000-0000-0000-0000-000000000010', fromTier: 'GROWTH', toTier: 'STARTER',
        fromBillingInterval: 'MONTHLY', toBillingInterval: 'YEARLY',
      });
      expect(result).toEqual({ applied: 1 });
    });
  });

  describe('processDueRenewals', () => {
    beforeEach(() => {
      subscriptionModel.findDueForRenewalReminder.mockResolvedValue([]);
      subscriptionModel.findDueForSuspensionWarning.mockResolvedValue([]);
      subscriptionModel.findExpiredPastGrace.mockResolvedValue([]);
      // Default: an ordinary ACTIVE tenant when expireSubscription fetches it
      // to decide whether to flip to PAST_DUE. Overridden per test below.
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' });
    });

    test('opens a renewal payment, logs RENEWAL_DUE, and notifies the tenant', async () => {
      const periodEnd = new Date('2026-07-06T00:00:00Z');
      subscriptionModel.findDueForRenewalReminder.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', billing_interval: 'MONTHLY', current_period_end: periodEnd },
      ]);
      paymentModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000040', subscription_id: '00000000-0000-0000-0000-000000000010', amount: 17.39, iva_rate: 0.15, iva_amount: 2.61, total_amount: 20, purpose: 'RENEWAL' });

      const result = await subscriptionService.processDueRenewals();

      expect(paymentModel.create).toHaveBeenCalledWith({ subscriptionId: '00000000-0000-0000-0000-000000000010', amount: 17.39, ivaRate: 0.15, ivaAmount: 2.61, totalAmount: 20, purpose: 'RENEWAL' });
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'RENEWAL_DUE', {
        subscriptionId: '00000000-0000-0000-0000-000000000010', paymentId: '00000000-0000-0000-0000-000000000040', tier: 'STARTER', currentPeriodEnd: periodEnd,
      });
      // notificationService.createSubscriptionRenewalDue owns creating the
      // in-app row synchronously and durably enqueuing NOTIFICATION_DISPATCH
      // for email internally (ADR-024) — subscription.service.js just calls
      // it with the full row objects, once.
      expect(notificationService.createSubscriptionRenewalDue).toHaveBeenCalledWith(
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', billing_interval: 'MONTHLY', current_period_end: periodEnd },
        { id: '00000000-0000-0000-0000-000000000040', subscription_id: '00000000-0000-0000-0000-000000000010', amount: 17.39, iva_rate: 0.15, iva_amount: 2.61, total_amount: 20, purpose: 'RENEWAL' },
      );
      // Priced as of current_period_end (when the renewal period actually
      // starts), not "now" — this is the 30-day price-change protection.
      expect(pricingService.getPriceAsOf).toHaveBeenCalledWith('STARTER', 'MONTHLY', periodEnd);
      expect(result).toEqual({ remindersSent: 1, pastDueWarningsSent: 0, expired: 0 });
    });

    test('prices the renewal from priceYearlyUsd when billing_interval is YEARLY', async () => {
      subscriptionModel.findDueForRenewalReminder.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'GROWTH', billing_interval: 'YEARLY', current_period_end: new Date() },
      ]);
      paymentModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000040' });

      await subscriptionService.processDueRenewals();

      expect(paymentModel.create).toHaveBeenCalledWith({ subscriptionId: '00000000-0000-0000-0000-000000000010', amount: 782.61, ivaRate: 0.15, ivaAmount: 117.39, totalAmount: 900, purpose: 'RENEWAL' });
    });

    test('a renewal due before a published price change\'s effective_at is still billed at the old price', async () => {
      // Simulates the 30-day protection end to end: getPriceAsOf resolves
      // whatever was in effect on current_period_end, not the "now" price.
      const periodEnd = new Date('2026-08-15T00:00:00Z');
      const newPriceEffectiveAt = new Date('2026-09-01T00:00:00Z');
      pricingService.getPriceAsOf.mockImplementation(async (tier, interval, asOfDate) => {
        if (tier === 'STARTER' && interval === 'MONTHLY') {
          return asOfDate < newPriceEffectiveAt ? 20 : 25;
        }
        return PRICES[tier][interval];
      });
      subscriptionModel.findDueForRenewalReminder.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', billing_interval: 'MONTHLY', current_period_end: periodEnd },
      ]);
      paymentModel.create.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000040' });

      await subscriptionService.processDueRenewals();

      // periodEnd is before the new price's effective_at -> still $20, not $25.
      expect(paymentModel.create).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 20 }));
    });

    test('downgrades an expired subscription to FREE, marks the tenant PAST_DUE, logs SUBSCRIPTION_EXPIRED + STATUS_CHANGED, and notifies the tenant', async () => {
      subscriptionModel.findExpiredPastGrace.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'GROWTH' },
      ]);
      subscriptionModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', status: 'EXPIRED' });
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE' });

      const result = await subscriptionService.processDueRenewals();

      expect(tenantModel.updateTier).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'FREE');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'FREE');
      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010', 'EXPIRED');
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'SUBSCRIPTION_EXPIRED', {
        subscriptionId: '00000000-0000-0000-0000-000000000010', previousTier: 'GROWTH',
      });
      expect(tenantModel.updateStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'PAST_DUE');
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'STATUS_CHANGED', {
        from: 'ACTIVE', to: 'PAST_DUE', reason: 'unpaid_renewal',
      });
      expect(notificationService.createSubscriptionExpired).toHaveBeenCalledWith({ id: '00000000-0000-0000-0000-000000000010', status: 'EXPIRED' });
      expect(result).toEqual({ remindersSent: 0, pastDueWarningsSent: 0, expired: 1 });
    });

    test('does not re-suspend or overwrite the reason when the tenant is already SUSPENDED', async () => {
      subscriptionModel.findExpiredPastGrace.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'GROWTH' },
      ]);
      subscriptionModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', status: 'EXPIRED' });
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', status: 'SUSPENDED' });

      await subscriptionService.processDueRenewals();

      expect(tenantModel.updateStatus).not.toHaveBeenCalled();
      expect(tenantEventModel.create).not.toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'STATUS_CHANGED', expect.anything());
    });

    test('does not re-flag an already-PAST_DUE tenant (a second subscription lapsing)', async () => {
      subscriptionModel.findExpiredPastGrace.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'GROWTH' },
      ]);
      subscriptionModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', status: 'EXPIRED' });
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', status: 'PAST_DUE' });

      await subscriptionService.processDueRenewals();

      expect(tenantModel.updateStatus).not.toHaveBeenCalled();
    });

    test('opens a PAST_DUE warning notification for a subscription partway through the grace window', async () => {
      const periodEnd = new Date('2026-07-01T00:00:00Z');
      subscriptionModel.findDueForSuspensionWarning.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', current_period_end: periodEnd },
      ]);

      const result = await subscriptionService.processDueRenewals();

      expect(notificationService.createSubscriptionPastDueWarning).toHaveBeenCalledWith(
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', current_period_end: periodEnd },
        new Date('2026-07-08T00:00:00Z'), // periodEnd + RENEWAL_GRACE_DAYS (7)
      );
      expect(result).toEqual({ remindersSent: 0, pastDueWarningsSent: 1, expired: 0 });
    });

    test('reports zero/zero when nothing is due either way', async () => {
      const result = await subscriptionService.processDueRenewals();

      expect(result).toEqual({ remindersSent: 0, pastDueWarningsSent: 0, expired: 0 });
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(tenantModel.updateTier).not.toHaveBeenCalled();
    });
  });

  describe('submitPaymentProof', () => {
    const files = [{ buffer: Buffer.from('test'), filename: 'receipt.pdf', mimeType: 'application/pdf' }];

    beforeEach(() => {
      paymentProofModel.countActiveByPaymentId.mockResolvedValue(0);
    });

    test('rejects when the payment does not exist', async () => {
      paymentModel.findById.mockResolvedValue(null);

      await expect(subscriptionService.submitPaymentProof('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', files))
        .rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
    });

    test('rejects when the payment belongs to a different tenant', async () => {
      paymentModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010', status: 'PENDING' });
      subscriptionModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000002' });

      await expect(subscriptionService.submitPaymentProof('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', files))
        .rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
    });

    test('rejects when the payment has already been VERIFIED', async () => {
      paymentModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010', status: 'VERIFIED' });
      subscriptionModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001' });

      await expect(subscriptionService.submitPaymentProof('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', files))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    test('rejects when the cumulative active file count would exceed the limit', async () => {
      paymentModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010', status: 'PENDING' });
      subscriptionModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001' });
      paymentProofModel.countActiveByPaymentId.mockResolvedValue(10);

      await expect(subscriptionService.submitPaymentProof('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', files))
        .rejects.toMatchObject({ statusCode: 400, code: 'PROOF_FILE_LIMIT_REACHED' });
      expect(paymentProofModel.createMany).not.toHaveBeenCalled();
    });

    test('allows re-submitting after REJECTED, adds new files without touching old ones, and clears the old rejection_reason_code', async () => {
      paymentModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010', status: 'REJECTED', rejection_reason_code: 'TRANSFER_NOT_FOUND' });
      subscriptionModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001' });
      paymentProofModel.createMany.mockResolvedValue([{ id: '00000000-0000-0000-0000-000000000002', payment_id: '00000000-0000-0000-0000-000000000020', filename: files[0].filename, mime_type: files[0].mimeType, reference_number: 'REF-123', active: true, created_at: new Date() }]);
      paymentModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', status: 'REPORTED' });

      await subscriptionService.submitPaymentProof('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', files, 'REF-123');

      expect(paymentProofModel.createMany).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000020', files, 'REF-123');
      expect(paymentModel.updateStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000020', 'REPORTED', {
        reported_at: expect.any(Date),
        rejection_reason_code: null,
      });
    });

    test('stores the files and moves the payment to REPORTED', async () => {
      paymentModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010', status: 'PENDING' });
      subscriptionModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001' });
      paymentProofModel.createMany.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000001', payment_id: '00000000-0000-0000-0000-000000000020', filename: 'receipt.pdf', mime_type: 'application/pdf', reference_number: 'REF-123', active: true, created_at: new Date('2026-06-01') },
      ]);
      paymentModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', status: 'REPORTED' });

      const result = await subscriptionService.submitPaymentProof('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', files, 'REF-123');

      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'PAYMENT_REPORTED', { paymentId: '00000000-0000-0000-0000-000000000020', proofCount: 1, referenceNumber: 'REF-123' });
      expect(result).toEqual({
        payment: { id: '00000000-0000-0000-0000-000000000020', status: 'REPORTED' },
        proofs: [{ id: '00000000-0000-0000-0000-000000000001', filename: 'receipt.pdf', mimeType: 'application/pdf', referenceNumber: 'REF-123', active: true, createdAt: new Date('2026-06-01') }],
      });
    });

    test('accepts multiple files in one submission', async () => {
      paymentModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010', status: 'PENDING' });
      subscriptionModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001' });
      const multiFiles = [
        { buffer: Buffer.from('a'), filename: 'front.pdf', mimeType: 'application/pdf' },
        { buffer: Buffer.from('b'), filename: 'back.pdf', mimeType: 'application/pdf' },
      ];
      paymentProofModel.createMany.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000001', payment_id: '00000000-0000-0000-0000-000000000020', filename: 'front.pdf', mime_type: 'application/pdf', active: true, created_at: new Date() },
        { id: '00000000-0000-0000-0000-000000000002', payment_id: '00000000-0000-0000-0000-000000000020', filename: 'back.pdf', mime_type: 'application/pdf', active: true, created_at: new Date() },
      ]);
      paymentModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', status: 'REPORTED' });

      const result = await subscriptionService.submitPaymentProof('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', multiFiles, 'REF-123');

      expect(paymentProofModel.createMany).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000020', multiFiles, 'REF-123');
      expect(result.proofs).toHaveLength(2);
    });

    test('notifies the operator (fire-and-forget) with the tenant that owns the payment', async () => {
      paymentModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010', status: 'PENDING' });
      subscriptionModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001' });
      paymentProofModel.createMany.mockResolvedValue([]);
      paymentModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', status: 'REPORTED' });
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', email: 'tenant@example.com' });

      await subscriptionService.submitPaymentProof('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', files, 'REF-123');

      // Durably enqueued (ADR-022) — the handler re-fetches payment/subscription/tenant.
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith('PAYMENT_PROOF_SUBMITTED_EMAIL', '00000000-0000-0000-0000-000000000001', {
        paymentId: '00000000-0000-0000-0000-000000000020',
        subscriptionId: '00000000-0000-0000-0000-000000000010',
        tenantId: '00000000-0000-0000-0000-000000000001',
        referenceNumber: 'REF-123',
      });
    });
  });

  describe('getPaymentProofFile (admin)', () => {
    test('rejects when the proof does not exist', async () => {
      paymentProofModel.findByIdAndPaymentId.mockResolvedValue(null);

      await expect(subscriptionService.getPaymentProofFile(20, 1)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('returns an inactive (soft-deleted) file too — admin sees full history', async () => {
      paymentProofModel.findByIdAndPaymentId.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001', payment_id: '00000000-0000-0000-0000-000000000020', file: Buffer.from('x'), filename: 'receipt.pdf', mime_type: 'application/pdf', active: false,
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
      paymentModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010' });
      paymentProofModel.findByIdAndPaymentId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', active: false });

      await expect(subscriptionService.getPaymentProofFileForTenant(20, 1, 1)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('returns an active file', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010' });
      paymentProofModel.findByIdAndPaymentId.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001', file: Buffer.from('x'), filename: 'receipt.pdf', mime_type: 'application/pdf', active: true,
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
      paymentModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020' });
      paymentProofModel.findActiveByPaymentId.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000001', filename: 'a.pdf', mime_type: 'application/pdf', active: true, created_at: new Date('2026-06-01') },
      ]);

      const result = await subscriptionService.listPaymentProofsForTenant(20, 1);

      expect(result).toEqual([{ id: '00000000-0000-0000-0000-000000000001', filename: 'a.pdf', mimeType: 'application/pdf', active: true, createdAt: new Date('2026-06-01') }]);
    });
  });

  describe('listPaymentProofsForAdmin', () => {
    test('returns every proof including inactive ones', async () => {
      paymentProofModel.findAllByPaymentId.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000001', filename: 'a.pdf', mime_type: 'application/pdf', active: true, created_at: new Date() },
        { id: '00000000-0000-0000-0000-000000000002', filename: 'b.pdf', mime_type: 'application/pdf', active: false, created_at: new Date() },
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
      paymentModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', status: 'VERIFIED' });

      await expect(subscriptionService.deletePaymentProofForTenant(20, 1, 1)).rejects.toMatchObject({ statusCode: 409 });
      expect(paymentProofModel.softDelete).not.toHaveBeenCalled();
    });

    test('rejects when the proof does not exist for this payment', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', status: 'PENDING' });
      paymentProofModel.softDelete.mockResolvedValue(null);

      await expect(subscriptionService.deletePaymentProofForTenant(20, 1, 1)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('soft-deletes the proof and returns it formatted', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', status: 'PENDING' });
      paymentProofModel.softDelete.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001', filename: 'a.pdf', mime_type: 'application/pdf', active: false, created_at: new Date('2026-06-01'),
      });

      const result = await subscriptionService.deletePaymentProofForTenant(20, 1, 1);

      expect(paymentProofModel.softDelete).toHaveBeenCalledWith(1, 20);
      expect(result).toEqual({ id: '00000000-0000-0000-0000-000000000001', filename: 'a.pdf', mimeType: 'application/pdf', active: false, createdAt: new Date('2026-06-01') });
    });
  });

  describe('reviewPayment', () => {
    test('rejects an invalid decision', async () => {
      await expect(subscriptionService.reviewPayment('00000000-0000-0000-0000-000000000020', 'MAYBE')).rejects.toMatchObject({ statusCode: 400 });
      expect(paymentModel.findById).not.toHaveBeenCalled();
    });

    test('VERIFIED applies the payment: an INITIAL payment activates the subscription and grants the tier', async () => {
      paymentModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010', purpose: 'INITIAL' });
      paymentModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', status: 'VERIFIED', purpose: 'INITIAL' });
      subscriptionModel.findById.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001',
        tier: 'STARTER', billing_interval: 'MONTHLY', status: 'PENDING_PAYMENT',
      });
      subscriptionModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', status: 'ACTIVE' });
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE', subscription_tier: 'FREE' });

      const result = await subscriptionService.reviewPayment('00000000-0000-0000-0000-000000000020', 'VERIFIED');

      expect(paymentModel.updateStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000020', 'VERIFIED', { verified_at: expect.any(Date) });
      // ADR-027: straight to ACTIVE, no PAYMENT_RECEIVED/INVOICE_PROCESSING
      // stopover waiting on the operator's invoice.
      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010', 'ACTIVE', expect.any(Object));
      expect(tenantModel.updateTier).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'STARTER');
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'PAYMENT_VERIFIED', { paymentId: '00000000-0000-0000-0000-000000000020' });
      expect(result.subscription).toEqual({ id: '00000000-0000-0000-0000-000000000010', status: 'ACTIVE' });
      // createPaymentReviewed owns creating the in-app row synchronously and
      // durably enqueuing NOTIFICATION_DISPATCH for email internally (ADR-024).
      expect(notificationService.createPaymentReviewed).toHaveBeenCalledWith(
        { id: '00000000-0000-0000-0000-000000000020', status: 'VERIFIED', purpose: 'INITIAL' },
        { id: '00000000-0000-0000-0000-000000000010', status: 'ACTIVE' },
        'VERIFIED',
      );
    });

    test('VERIFIED applies a TIER_CHANGE payment immediately, flipping the tier', async () => {
      paymentModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000021', subscription_id: '00000000-0000-0000-0000-000000000011', purpose: 'TIER_CHANGE' });
      paymentModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000021', status: 'VERIFIED', purpose: 'TIER_CHANGE', target_tier: 'GROWTH', target_billing_interval: null });
      subscriptionModel.findById.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000011', tenant_id: '00000000-0000-0000-0000-000000000001',
        tier: 'STARTER', billing_interval: 'MONTHLY', status: 'ACTIVE',
        current_period_start: new Date('2026-03-01'), current_period_end: new Date('2026-04-01'),
      });
      subscriptionModel.applyTierChange.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000011', tier: 'GROWTH' });
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE', subscription_tier: 'STARTER' });

      const result = await subscriptionService.reviewPayment('00000000-0000-0000-0000-000000000021', 'VERIFIED');

      expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000011', 'GROWTH', null);
      expect(tenantModel.updateTier).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'GROWTH');
      expect(result.subscription).toEqual({ id: '00000000-0000-0000-0000-000000000011', tier: 'GROWTH' });
    });

    test('VERIFIED applies a RENEWAL payment, extending the period from the old period end', async () => {
      paymentModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000022', subscription_id: '00000000-0000-0000-0000-000000000012', purpose: 'RENEWAL' });
      paymentModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000022', status: 'VERIFIED', purpose: 'RENEWAL' });
      subscriptionModel.findById.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000012', tenant_id: '00000000-0000-0000-0000-000000000001',
        tier: 'GROWTH', billing_interval: 'MONTHLY', status: 'ACTIVE',
        current_period_start: new Date('2026-03-15T12:00:00Z'), current_period_end: new Date('2026-04-15T12:00:00Z'),
      });
      subscriptionModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000012', status: 'ACTIVE' });
      tenantModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', status: 'ACTIVE', subscription_tier: 'GROWTH' });

      await subscriptionService.reviewPayment('00000000-0000-0000-0000-000000000022', 'VERIFIED');

      const fields = subscriptionModel.updateStatus.mock.calls[0][2];
      expect(fields.current_period_start).toEqual(new Date('2026-04-15T12:00:00Z'));
      expect(fields.current_period_end).toEqual(new Date('2026-05-15T12:00:00Z'));
    });

    test('REJECTED leaves the subscription untouched and stores the rejection reason code', async () => {
      paymentModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', subscription_id: '00000000-0000-0000-0000-000000000010' });
      paymentModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020', status: 'REJECTED' });
      subscriptionModel.findById.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', status: 'PENDING_PAYMENT' });

      const result = await subscriptionService.reviewPayment('00000000-0000-0000-0000-000000000020', 'REJECTED', 'TRANSFER_NOT_FOUND');

      expect(paymentModel.updateStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000020', 'REJECTED', {
        rejection_reason_code: 'TRANSFER_NOT_FOUND',
      });
      expect(subscriptionModel.updateStatus).not.toHaveBeenCalled();
      expect(tenantEventModel.create).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'PAYMENT_REJECTED', { paymentId: '00000000-0000-0000-0000-000000000020' });
      expect(result.subscription).toEqual({ id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', status: 'PENDING_PAYMENT' });
      expect(notificationService.createPaymentReviewed).toHaveBeenCalledWith(
        { id: '00000000-0000-0000-0000-000000000020', status: 'REJECTED' },
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', status: 'PENDING_PAYMENT' },
        'REJECTED',
      );
    });

    test('rejects REJECTED decision with a missing rejectionReasonCode', async () => {
      await expect(subscriptionService.reviewPayment('00000000-0000-0000-0000-000000000020', 'REJECTED'))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_REJECTION_REASON' });
      expect(paymentModel.findById).not.toHaveBeenCalled();
    });

    test('rejects REJECTED decision with an unrecognized rejectionReasonCode', async () => {
      await expect(subscriptionService.reviewPayment('00000000-0000-0000-0000-000000000020', 'REJECTED', 'NOT_A_REASON'))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_REJECTION_REASON' });
      expect(paymentModel.findById).not.toHaveBeenCalled();
    });

    test('rejects when the payment does not exist', async () => {
      paymentModel.findById.mockResolvedValue(null);

      await expect(subscriptionService.reviewPayment(999, 'VERIFIED'))
        .rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
    });
  });

  describe('linkInvoice', () => {
    const accessKey = '1234567890123456789012345678901234567890123456789';
    const TENANT = '00000000-0000-0000-0000-000000000001';
    const SUB = '00000000-0000-0000-0000-000000000010';
    const DOC = '00000000-0000-0000-0000-000000000999';

    beforeEach(() => {
      subscriptionModel.findById.mockResolvedValue({ id: SUB, tenant_id: TENANT, status: 'ACTIVE' });
      subscriptionModel.setInitialInvoiceDocument.mockResolvedValue({ id: SUB });
      paymentModel.updateStatus.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000020' });
    });

    test('rejects when the subscription does not exist', async () => {
      subscriptionModel.findById.mockResolvedValue(null);
      await expect(subscriptionService.linkInvoice(SUB, accessKey))
        .rejects.toMatchObject({ statusCode: 404, code: 'SUBSCRIPTION_NOT_FOUND' });
    });

    test('rejects when the document does not exist', async () => {
      documentModel.findByAccessKey.mockResolvedValue(null);
      await expect(subscriptionService.linkInvoice(SUB, accessKey))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    test('rejects when no verified payment is awaiting an invoice', async () => {
      documentModel.findByAccessKey.mockResolvedValue({ id: DOC, status: 'AUTHORIZED', sandbox: false });
      paymentModel.findOldestUninvoicedBySubscriptionId.mockResolvedValue(null);

      await expect(subscriptionService.linkInvoice(SUB, accessKey))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    // The whole point of ADR-027: linking is bookkeeping. The subscription was
    // already activated when the payment was verified.
    test('an INITIAL payment writes subscriptions.initial_invoice_document_id and stamps invoiced_at', async () => {
      documentModel.findByAccessKey.mockResolvedValue({ id: DOC, status: 'AUTHORIZED', sandbox: false });
      paymentModel.findOldestUninvoicedBySubscriptionId.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000020', purpose: 'INITIAL', status: 'VERIFIED',
      });

      await subscriptionService.linkInvoice(SUB, accessKey);

      expect(subscriptionModel.setInitialInvoiceDocument).toHaveBeenCalledWith(SUB, DOC);
      expect(paymentModel.updateStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000020', 'VERIFIED', {
        invoiced_at: expect.any(Date),
      });
      // No state transition at all.
      expect(subscriptionModel.updateStatus).not.toHaveBeenCalled();
      expect(tenantModel.updateTier).not.toHaveBeenCalled();
      expect(tenantEventModel.create).toHaveBeenCalledWith(TENANT, 'INVOICE_LINKED', {
        subscriptionId: SUB, paymentId: '00000000-0000-0000-0000-000000000020', documentId: DOC, sandbox: false,
      });
    });

    // initial_invoice_document_id records what ORIGINALLY activated the
    // subscription and is never repointed — a later funding event writes its
    // own payments.invoice_document_id instead.
    test('a TIER_CHANGE payment writes payments.invoice_document_id, never the subscription column', async () => {
      documentModel.findByAccessKey.mockResolvedValue({ id: DOC, status: 'AUTHORIZED', sandbox: false });
      paymentModel.findOldestUninvoicedBySubscriptionId.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000021', purpose: 'TIER_CHANGE', status: 'VERIFIED',
      });

      await subscriptionService.linkInvoice(SUB, accessKey);

      expect(subscriptionModel.setInitialInvoiceDocument).not.toHaveBeenCalled();
      expect(paymentModel.updateStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000021', 'VERIFIED', {
        invoiced_at: expect.any(Date), invoice_document_id: DOC,
      });
    });

    test('a RENEWAL payment behaves the same as TIER_CHANGE', async () => {
      documentModel.findByAccessKey.mockResolvedValue({ id: DOC, status: 'AUTHORIZED', sandbox: false });
      paymentModel.findOldestUninvoicedBySubscriptionId.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000022', purpose: 'RENEWAL', status: 'VERIFIED',
      });

      await subscriptionService.linkInvoice(SUB, accessKey);

      expect(paymentModel.updateStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000022', 'VERIFIED', {
        invoiced_at: expect.any(Date), invoice_document_id: DOC,
      });
    });

    // Both FK columns reference public.documents; sandbox.documents is an
    // independent id sequence that can collide with it. invoiced_at is still
    // stamped, which is what the queue reads.
    describe('sandbox documents', () => {
      test('stamps invoiced_at but writes neither FK', async () => {
        documentModel.findByAccessKey.mockResolvedValue({ id: DOC, status: 'AUTHORIZED', sandbox: true });
        paymentModel.findOldestUninvoicedBySubscriptionId.mockResolvedValue({
          id: '00000000-0000-0000-0000-000000000023', purpose: 'TIER_CHANGE', status: 'VERIFIED',
        });

        await subscriptionService.linkInvoice(SUB, accessKey);

        expect(subscriptionModel.setInitialInvoiceDocument).not.toHaveBeenCalled();
        expect(paymentModel.updateStatus).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000023', 'VERIFIED', {
          invoiced_at: expect.any(Date),
        });
      });

      test('an INITIAL sandbox invoice also skips the subscription FK', async () => {
        documentModel.findByAccessKey.mockResolvedValue({ id: DOC, status: 'AUTHORIZED', sandbox: true });
        paymentModel.findOldestUninvoicedBySubscriptionId.mockResolvedValue({
          id: '00000000-0000-0000-0000-000000000024', purpose: 'INITIAL', status: 'VERIFIED',
        });

        await subscriptionService.linkInvoice(SUB, accessKey);

        expect(subscriptionModel.setInitialInvoiceDocument).not.toHaveBeenCalled();
      });
    });
  });

  describe('listPendingInvoices', () => {
    test('returns a count plus a per-payment block with the buyer identity for the factura', async () => {
      paymentModel.findPendingInvoice.mockResolvedValue([
        {
          id: '00000000-0000-0000-0000-000000000020', purpose: 'INITIAL', method: 'SPI_TRANSFER',
          amount: '17.39', iva_rate: '0.15', iva_amount: '2.61', total_amount: '20.00',
          verified_at: new Date('2026-03-02'),
          subscription_id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001',
          tier: 'STARTER', billing_interval: 'MONTHLY',
          current_period_start: new Date('2026-03-01'), current_period_end: new Date('2026-04-01'),
          period_start: null, period_end: null,
          target_tier: null, target_billing_interval: null,
          tenant_email: 'a@b.com', business_name: 'ACME SA', ruc: '1790012345001', main_address: 'Av. Siempre Viva 123',
        },
      ]);

      const result = await subscriptionService.listPendingInvoices();

      expect(result.count).toBe(1);
      expect(result.items[0].buyer).toEqual({
        tenantId: '00000000-0000-0000-0000-000000000001', email: 'a@b.com',
        businessName: 'ACME SA', ruc: '1790012345001', address: 'Av. Siempre Viva 123',
      });
      expect(result.items[0].subscription.tier).toBe('STARTER');
      expect(result.items[0].payment.totalAmount).toBe('20.00');
    });

    // Common Mistake #28: for a TIER_CHANGE the subscription's own columns
    // describe what it is now, not what this payment bought.
    test('a TIER_CHANGE payment reports the target tier/interval, not the subscription current ones', async () => {
      paymentModel.findPendingInvoice.mockResolvedValue([
        {
          id: '00000000-0000-0000-0000-000000000021', purpose: 'TIER_CHANGE', method: 'SPI_TRANSFER',
          amount: '60.87', iva_rate: '0.15', iva_amount: '9.13', total_amount: '70.00',
          verified_at: new Date('2026-03-10'),
          subscription_id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001',
          tier: 'STARTER', billing_interval: 'MONTHLY',
          current_period_start: new Date('2026-03-01'), current_period_end: new Date('2026-04-01'),
          period_start: new Date('2026-03-01'), period_end: new Date('2026-04-01'),
          target_tier: 'GROWTH', target_billing_interval: 'YEARLY',
          tenant_email: 'a@b.com', business_name: 'ACME SA', ruc: '1790012345001', main_address: 'Av. 1',
        },
      ]);

      const result = await subscriptionService.listPendingInvoices();

      expect(result.items[0].subscription.tier).toBe('GROWTH');
      expect(result.items[0].subscription.billingInterval).toBe('YEARLY');
    });

    test('reports zero when nothing is owed', async () => {
      paymentModel.findPendingInvoice.mockResolvedValue([]);
      await expect(subscriptionService.listPendingInvoices()).resolves.toEqual({ count: 0, items: [] });
    });
  });

  describe('refundPayment', () => {
    const TENANT = '00000000-0000-0000-0000-000000000001';
    const SUB = '00000000-0000-0000-0000-000000000010';
    const PAY = '00000000-0000-0000-0000-000000000020';

    beforeEach(() => {
      subscriptionModel.applyTierChange.mockResolvedValue({ id: SUB });
      subscriptionModel.updateStatus.mockResolvedValue({ id: SUB, status: 'ACTIVE' });
      paymentModel.updateStatus.mockResolvedValue({ id: PAY, status: 'REFUNDED' });
      subscriptionModel.findById.mockResolvedValue({ id: SUB, tenant_id: TENANT, tier: 'GROWTH', status: 'ACTIVE' });
    });

    test('rejects a payment that is not VERIFIED', async () => {
      paymentModel.findById.mockResolvedValue({ id: PAY, status: 'REPORTED' });
      await expect(subscriptionService.refundPayment(PAY))
        .rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_NOT_REFUNDABLE' });
    });

    // Payments applied before migration 090 have no snapshot; guessing would
    // corrupt state, so refuse rather than approximate.
    test('rejects a payment with no applied_from snapshot', async () => {
      paymentModel.findById.mockResolvedValue({ id: PAY, status: 'VERIFIED', applied_from: null });
      await expect(subscriptionService.refundPayment(PAY))
        .rejects.toMatchObject({ statusCode: 400, code: 'PAYMENT_NOT_REFUNDABLE' });
    });

    // The case that motivated the endpoint: a hand-rolled downgrade via
    // PATCH /admin/tenants/:id/tier leaves subscriptions.tier stale, and
    // createRenewalReminder then prices the next renewal off it.
    test('a reversed TIER_CHANGE restores the PREVIOUS PAID tier on both the subscription and the tenant', async () => {
      paymentModel.findById.mockResolvedValue({
        id: PAY, status: 'VERIFIED', purpose: 'TIER_CHANGE', subscription_id: SUB,
        applied_from: {
          tier: 'STARTER', billingInterval: 'MONTHLY',
          periodStart: '2026-03-01T00:00:00.000Z', periodEnd: '2026-04-01T00:00:00.000Z',
          subscriptionStatus: 'ACTIVE', tenantTier: 'STARTER',
        },
      });

      const result = await subscriptionService.refundPayment(PAY, 'Chargeback 8891');

      expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith(SUB, 'STARTER', 'MONTHLY');
      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(SUB, 'ACTIVE', {
        current_period_start: '2026-03-01T00:00:00.000Z',
        current_period_end: '2026-04-01T00:00:00.000Z',
      });
      // Never FREE — that was the bug this endpoint exists to avoid.
      expect(tenantModel.updateTier).toHaveBeenCalledWith(TENANT, 'STARTER');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith(TENANT, 'STARTER');
      expect(paymentModel.updateStatus).toHaveBeenCalledWith(PAY, 'REFUNDED');
      expect(tenantEventModel.create).toHaveBeenCalledWith(TENANT, 'PAYMENT_REFUNDED', expect.objectContaining({
        paymentId: PAY, purpose: 'TIER_CHANGE', reason: 'Chargeback 8891', restoredTier: 'STARTER',
      }));
      expect(result.payment.status).toBe('REFUNDED');
    });

    test('a reversed RENEWAL rolls the period back and leaves the tier alone', async () => {
      paymentModel.findById.mockResolvedValue({
        id: PAY, status: 'VERIFIED', purpose: 'RENEWAL', subscription_id: SUB,
        applied_from: {
          tier: 'GROWTH', billingInterval: 'MONTHLY',
          periodStart: '2026-03-01T00:00:00.000Z', periodEnd: '2026-04-01T00:00:00.000Z',
          subscriptionStatus: 'ACTIVE', tenantTier: 'GROWTH',
        },
      });

      await subscriptionService.refundPayment(PAY);

      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(SUB, 'ACTIVE', {
        current_period_start: '2026-03-01T00:00:00.000Z',
        current_period_end: '2026-04-01T00:00:00.000Z',
      });
      expect(tenantModel.updateTier).toHaveBeenCalledWith(TENANT, 'GROWTH');
    });

    // Restoring PENDING_PAYMENT verbatim would leave a subscription that looks
    // payable but whose only payment is REFUNDED, and would block the tenant
    // from starting a new one via findActiveOrPendingByTenantId.
    test('a reversed INITIAL cancels the subscription and drops the tenant to their pre-subscription tier', async () => {
      paymentModel.findById.mockResolvedValue({
        id: PAY, status: 'VERIFIED', purpose: 'INITIAL', subscription_id: SUB,
        applied_from: {
          tier: 'STARTER', billingInterval: 'MONTHLY',
          periodStart: null, periodEnd: null,
          subscriptionStatus: 'PENDING_PAYMENT', tenantTier: 'FREE',
        },
      });

      await subscriptionService.refundPayment(PAY);

      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(SUB, 'CANCELLED', {
        canceled_at: expect.any(Date), current_period_start: null, current_period_end: null,
      });
      expect(tenantModel.updateTier).toHaveBeenCalledWith(TENANT, 'FREE');
      expect(tenantQuotaService.setCap).toHaveBeenCalledWith(TENANT, 'FREE');
    });

    // Suspension is a separate operator judgement — an honest duplicate charge
    // is not a reason to lock the tenant out.
    test('never suspends the tenant', async () => {
      paymentModel.findById.mockResolvedValue({
        id: PAY, status: 'VERIFIED', purpose: 'INITIAL', subscription_id: SUB,
        applied_from: {
          tier: 'STARTER', billingInterval: 'MONTHLY', periodStart: null, periodEnd: null,
          subscriptionStatus: 'PENDING_PAYMENT', tenantTier: 'FREE',
        },
      });

      await subscriptionService.refundPayment(PAY);

      expect(tenantModel.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('getStatusForTenant', () => {
    test('returns each subscription with its payments nested (proof files live behind the dedicated proofs endpoints, not inline here)', async () => {
      subscriptionModel.findByTenantId.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', status: 'INVOICE_PROCESSING' },
      ]);
      paymentModel.findBySubscriptionId.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000020', status: 'REJECTED', rejection_reason_code: 'TRANSFER_NOT_FOUND' },
        { id: '00000000-0000-0000-0000-000000000021', status: 'VERIFIED' },
      ]);

      const result = await subscriptionService.getStatusForTenant('00000000-0000-0000-0000-000000000001');

      expect(subscriptionModel.findByTenantId).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001');
      expect(paymentModel.findBySubscriptionId).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010');
      expect(result).toEqual([
        {
          id: '00000000-0000-0000-0000-000000000010', tenant_id: '00000000-0000-0000-0000-000000000001', tier: 'STARTER', status: 'INVOICE_PROCESSING',
          payments: [
            { id: '00000000-0000-0000-0000-000000000020', status: 'REJECTED', rejection_reason_code: 'TRANSFER_NOT_FOUND' },
            { id: '00000000-0000-0000-0000-000000000021', status: 'VERIFIED' },
          ],
        },
      ]);
    });

    test('returns an empty array for a tenant who never subscribed', async () => {
      subscriptionModel.findByTenantId.mockResolvedValue([]);

      const result = await subscriptionService.getStatusForTenant('00000000-0000-0000-0000-000000000001');

      expect(result).toEqual([]);
      expect(paymentModel.findBySubscriptionId).not.toHaveBeenCalled();
    });
  });
});
