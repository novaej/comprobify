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
