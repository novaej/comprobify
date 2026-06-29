jest.mock('../../../src/models/subscription.model');
jest.mock('../../../src/models/payment.model');
jest.mock('../../../src/models/document.model');
jest.mock('../../../src/models/tenant.model');
jest.mock('../../../src/models/tenant-event.model');

const subscriptionModel = require('../../../src/models/subscription.model');
const paymentModel = require('../../../src/models/payment.model');
const documentModel = require('../../../src/models/document.model');
const tenantModel = require('../../../src/models/tenant.model');
const tenantEventModel = require('../../../src/models/tenant-event.model');
const config = require('../../../src/config');
const subscriptionService = require('../../../src/services/subscription.service');

describe('SubscriptionService', () => {
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
      paymentModel.create.mockResolvedValue({ id: 20, subscription_id: 10, amount: 19 });

      const result = await subscriptionService.createSubscription(1, 'STARTER');

      expect(subscriptionModel.create).toHaveBeenCalledWith({ tenantId: 1, tier: 'STARTER', billingInterval: 'MONTHLY' });
      expect(paymentModel.create).toHaveBeenCalledWith({ subscriptionId: 10, amount: 19 });
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'SUBSCRIPTION_CREATED', { subscriptionId: 10, tier: 'STARTER', billingInterval: 'MONTHLY' });
      expect(result).toEqual({
        subscription: { id: 10, tenant_id: 1, tier: 'STARTER' },
        payment: { id: 20, subscription_id: 10, amount: 19 },
        bankTransfer: config.bankTransfer,
      });
    });

    test('prices from priceYearlyUsd and stores billing_interval when YEARLY is requested', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveOrPendingByTenantId.mockResolvedValue(null);
      subscriptionModel.create.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER', billing_interval: 'YEARLY' });
      paymentModel.create.mockResolvedValue({ id: 20, subscription_id: 10, amount: 190 });

      await subscriptionService.createSubscription(1, 'STARTER', 'YEARLY');

      expect(subscriptionModel.create).toHaveBeenCalledWith({ tenantId: 1, tier: 'STARTER', billingInterval: 'YEARLY' });
      expect(paymentModel.create).toHaveBeenCalledWith({ subscriptionId: 10, amount: 190 });
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

      // GROWTH (79) - STARTER (19) = 60, ~50% of the period remains -> ~30
      const [createArgs] = paymentModel.create.mock.calls[0];
      expect(createArgs.subscriptionId).toBe(10);
      expect(createArgs.purpose).toBe('TIER_CHANGE');
      expect(createArgs.targetTier).toBe('GROWTH');
      expect(createArgs.amount).toBeCloseTo(30, 0);
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
      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'GROWTH', 1000);
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGED', {
        subscriptionId: 10, fromTier: 'STARTER', toTier: 'GROWTH', amount: 0,
      });
      expect(result).toEqual({ subscription: { id: 10, tier: 'GROWTH' }, payment: null, amount: 0 });
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
      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'GROWTH', 1000);
      expect(paymentModel.updateStatus).toHaveBeenCalledWith(30, 'VERIFIED', {
        period_start: periodStart, period_end: periodEnd,
      });
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGED', {
        subscriptionId: 10, fromTier: 'STARTER', toTier: 'GROWTH', paymentId: 30,
      });
      expect(result).toEqual({ id: 10, tier: 'GROWTH' });
    });
  });

  describe('applyScheduledTierChanges', () => {
    test('applies every due downgrade and reports the count', async () => {
      subscriptionModel.findDuePendingDowngrades.mockResolvedValue([
        { id: 10, tenant_id: 1, tier: 'GROWTH', pending_tier: 'STARTER' },
        { id: 11, tenant_id: 2, tier: 'BUSINESS', pending_tier: 'GROWTH' },
      ]);

      const result = await subscriptionService.applyScheduledTierChanges();

      expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith(10, 'STARTER');
      expect(subscriptionModel.applyTierChange).toHaveBeenCalledWith(11, 'GROWTH');
      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'STARTER', 200);
      expect(tenantModel.updateTier).toHaveBeenCalledWith(2, 'GROWTH', 1000);
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'TIER_CHANGED', {
        subscriptionId: 10, fromTier: 'GROWTH', toTier: 'STARTER',
      });
      expect(result).toEqual({ applied: 2 });
    });

    test('reports zero when nothing is due', async () => {
      subscriptionModel.findDuePendingDowngrades.mockResolvedValue([]);

      const result = await subscriptionService.applyScheduledTierChanges();

      expect(result).toEqual({ applied: 0 });
      expect(subscriptionModel.applyTierChange).not.toHaveBeenCalled();
    });
  });

  describe('submitPaymentProof', () => {
    const proof = { buffer: Buffer.from('test'), filename: 'receipt.pdf', mimeType: 'application/pdf' };

    test('rejects when the payment does not exist', async () => {
      paymentModel.findById.mockResolvedValue(null);

      await expect(subscriptionService.submitPaymentProof(20, 1, proof))
        .rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
    });

    test('rejects when the payment belongs to a different tenant', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10, status: 'PENDING' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 2 });

      await expect(subscriptionService.submitPaymentProof(20, 1, proof))
        .rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
    });

    test('rejects when the payment has already been VERIFIED', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10, status: 'VERIFIED' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1 });

      await expect(subscriptionService.submitPaymentProof(20, 1, proof))
        .rejects.toMatchObject({ statusCode: 409 });
    });

    test('allows re-submitting after REJECTED and clears the old rejection_reason', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10, status: 'REJECTED', rejection_reason: 'Transfer not reflected yet' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1 });
      paymentModel.updateStatus.mockResolvedValue({ id: 20, status: 'REPORTED' });

      await subscriptionService.submitPaymentProof(20, 1, proof);

      expect(paymentModel.updateStatus).toHaveBeenCalledWith(20, 'REPORTED', {
        reported_at: expect.any(Date),
        proof_file: proof.buffer,
        proof_filename: proof.filename,
        proof_mime_type: proof.mimeType,
        rejection_reason: null,
      });
    });

    test('stores the proof and moves the payment to REPORTED', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10, status: 'PENDING' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1 });
      paymentModel.updateStatus.mockResolvedValue({ id: 20, status: 'REPORTED' });

      const result = await subscriptionService.submitPaymentProof(20, 1, proof);

      expect(paymentModel.updateStatus).toHaveBeenCalledWith(20, 'REPORTED', {
        reported_at: expect.any(Date),
        proof_file: proof.buffer,
        proof_filename: proof.filename,
        proof_mime_type: proof.mimeType,
        rejection_reason: null,
      });
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'PAYMENT_REPORTED', { paymentId: 20 });
      expect(result).toEqual({ id: 20, status: 'REPORTED' });
    });
  });

  describe('getPaymentProof', () => {
    test('rejects when no proof was uploaded', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, proof_file: null });

      await expect(subscriptionService.getPaymentProof(20)).rejects.toMatchObject({ statusCode: 404 });
    });

    test('returns the stored file', async () => {
      paymentModel.findById.mockResolvedValue({
        id: 20, proof_file: Buffer.from('x'), proof_filename: 'receipt.pdf', proof_mime_type: 'application/pdf',
      });

      const result = await subscriptionService.getPaymentProof(20);

      expect(result).toEqual({ buffer: Buffer.from('x'), filename: 'receipt.pdf', mimeType: 'application/pdf' });
    });
  });

  describe('reviewPayment', () => {
    test('rejects an invalid decision', async () => {
      await expect(subscriptionService.reviewPayment(20, 'MAYBE')).rejects.toMatchObject({ statusCode: 400 });
      expect(paymentModel.findById).not.toHaveBeenCalled();
    });

    test('VERIFIED moves the linked subscription to PAYMENT_RECEIVED', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10 });
      paymentModel.updateStatus.mockResolvedValue({ id: 20, status: 'VERIFIED' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, status: 'PENDING_PAYMENT' });
      subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'PAYMENT_RECEIVED' });

      const result = await subscriptionService.reviewPayment(20, 'VERIFIED');

      expect(paymentModel.updateStatus).toHaveBeenCalledWith(20, 'VERIFIED', { verified_at: expect.any(Date) });
      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(10, 'PAYMENT_RECEIVED');
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'PAYMENT_VERIFIED', { paymentId: 20 });
      expect(result.subscription).toEqual({ id: 10, status: 'PAYMENT_RECEIVED' });
    });

    test('REJECTED leaves the subscription untouched and stores the rejection reason', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10 });
      paymentModel.updateStatus.mockResolvedValue({ id: 20, status: 'REJECTED' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, status: 'PENDING_PAYMENT' });

      const result = await subscriptionService.reviewPayment(20, 'REJECTED', 'Transfer not reflected in our account yet');

      expect(paymentModel.updateStatus).toHaveBeenCalledWith(20, 'REJECTED', {
        rejection_reason: 'Transfer not reflected in our account yet',
      });
      expect(subscriptionModel.updateStatus).not.toHaveBeenCalled();
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'PAYMENT_REJECTED', { paymentId: 20 });
      expect(result.subscription).toEqual({ id: 10, tenant_id: 1, status: 'PENDING_PAYMENT' });
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
      subscriptionModel.findByInvoiceDocumentId.mockResolvedValue(null);

      const result = await subscriptionService.activateIfLinked(999);

      expect(result).toBeNull();
      expect(tenantModel.updateTier).not.toHaveBeenCalled();
    });

    test('is a no-op when the linked subscription is not awaiting invoice processing', async () => {
      subscriptionModel.findByInvoiceDocumentId.mockResolvedValue({ id: 10, status: 'CANCELLED' });

      const result = await subscriptionService.activateIfLinked(999);

      expect(result).toBeNull();
      expect(tenantModel.updateTier).not.toHaveBeenCalled();
    });

    test('activates the subscription and grants the tier when authorized (MONTHLY, +1 month)', async () => {
      subscriptionModel.findByInvoiceDocumentId.mockResolvedValue({
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
      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'STARTER', 200);
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'SUBSCRIPTION_ACTIVATED', { subscriptionId: 10, tier: 'STARTER' });
      expect(result).toEqual({ id: 10, status: 'ACTIVE' });
    });

    test('uses a +1 year period when billing_interval is YEARLY', async () => {
      subscriptionModel.findByInvoiceDocumentId.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'STARTER', status: 'INVOICE_PROCESSING', billing_interval: 'YEARLY',
      });
      subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'ACTIVE' });

      await subscriptionService.activateIfLinked(999);

      const [, , extra] = subscriptionModel.updateStatus.mock.calls[0];
      expect(extra.current_period_end.getFullYear() - extra.current_period_start.getFullYear()).toBe(1);
    });

    test('stamps period_start/period_end onto the verified payment that funded this cycle', async () => {
      subscriptionModel.findByInvoiceDocumentId.mockResolvedValue({
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
      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(10, 'INVOICE_PROCESSING', { invoice_document_id: 999 });
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'INVOICE_LINKED', { subscriptionId: 10, documentId: 999 });
      expect(result).toEqual({ id: 10, status: 'INVOICE_PROCESSING' });
    });

    test('activates immediately when the document being linked is already AUTHORIZED', async () => {
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER' });
      documentModel.findByAccessKey.mockResolvedValue({ id: 999, status: 'AUTHORIZED' });
      subscriptionModel.updateStatus
        .mockResolvedValueOnce({ id: 10, status: 'INVOICE_PROCESSING' }) // the link itself
        .mockResolvedValueOnce({ id: 10, status: 'ACTIVE' });           // inside activateIfLinked
      subscriptionModel.findByInvoiceDocumentId.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'STARTER', status: 'INVOICE_PROCESSING', billing_interval: 'MONTHLY',
      });

      const result = await subscriptionService.linkInvoice(10, accessKey);

      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'STARTER', 200);
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

      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'GROWTH', 1000);
      expect(result).toEqual({ id: 10, tier: 'GROWTH' });
    });
  });

  describe('getStatusForTenant', () => {
    test('returns each subscription with its payments nested, proof_file stripped', async () => {
      subscriptionModel.findByTenantId.mockResolvedValue([
        { id: 10, tenant_id: 1, tier: 'STARTER', status: 'INVOICE_PROCESSING' },
      ]);
      paymentModel.findBySubscriptionId.mockResolvedValue([
        { id: 20, status: 'REJECTED', rejection_reason: 'Transfer not reflected yet', proof_file: Buffer.from('x'), proof_filename: 'old.pdf' },
        { id: 21, status: 'VERIFIED', proof_file: Buffer.from('y'), proof_filename: 'new.pdf' },
      ]);

      const result = await subscriptionService.getStatusForTenant(1);

      expect(subscriptionModel.findByTenantId).toHaveBeenCalledWith(1);
      expect(paymentModel.findBySubscriptionId).toHaveBeenCalledWith(10);
      expect(result).toEqual([
        {
          id: 10, tenant_id: 1, tier: 'STARTER', status: 'INVOICE_PROCESSING',
          payments: [
            { id: 20, status: 'REJECTED', rejection_reason: 'Transfer not reflected yet', proof_filename: 'old.pdf' },
            { id: 21, status: 'VERIFIED', proof_filename: 'new.pdf' },
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
