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

    test('creates a subscription and a payment priced from the tier, and logs an event', async () => {
      tenantModel.findById.mockResolvedValue({ id: 1 });
      subscriptionModel.findActiveOrPendingByTenantId.mockResolvedValue(null);
      subscriptionModel.create.mockResolvedValue({ id: 10, tenant_id: 1, tier: 'STARTER' });
      paymentModel.create.mockResolvedValue({ id: 20, subscription_id: 10, amount: 19 });

      const result = await subscriptionService.createSubscription(1, 'STARTER');

      expect(subscriptionModel.create).toHaveBeenCalledWith({ tenantId: 1, tier: 'STARTER' });
      expect(paymentModel.create).toHaveBeenCalledWith({ subscriptionId: 10, amount: 19 });
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'SUBSCRIPTION_CREATED', { subscriptionId: 10, tier: 'STARTER' });
      expect(result).toEqual({
        subscription: { id: 10, tenant_id: 1, tier: 'STARTER' },
        payment: { id: 20, subscription_id: 10, amount: 19 },
      });
    });
  });

  describe('verifyPayment', () => {
    test('moves the linked subscription to PAYMENT_RECEIVED', async () => {
      paymentModel.findById.mockResolvedValue({ id: 20, subscription_id: 10 });
      paymentModel.updateStatus.mockResolvedValue({ id: 20, status: 'VERIFIED' });
      subscriptionModel.findById.mockResolvedValue({ id: 10, tenant_id: 1, status: 'PENDING_PAYMENT' });
      subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'PAYMENT_RECEIVED' });

      const result = await subscriptionService.verifyPayment(20);

      expect(paymentModel.updateStatus).toHaveBeenCalledWith(20, 'VERIFIED', { verified_at: expect.any(Date) });
      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(10, 'PAYMENT_RECEIVED');
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'PAYMENT_VERIFIED', { paymentId: 20 });
      expect(result.subscription).toEqual({ id: 10, status: 'PAYMENT_RECEIVED' });
    });

    test('rejects when the payment does not exist', async () => {
      paymentModel.findById.mockResolvedValue(null);

      await expect(subscriptionService.verifyPayment(999))
        .rejects.toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
    });
  });

  describe('activateIfLinked', () => {
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

    test('activates the subscription and grants the tier when authorized', async () => {
      subscriptionModel.findByInvoiceDocumentId.mockResolvedValue({
        id: 10, tenant_id: 1, tier: 'STARTER', status: 'INVOICE_PROCESSING',
      });
      subscriptionModel.updateStatus.mockResolvedValue({ id: 10, status: 'ACTIVE' });

      const result = await subscriptionService.activateIfLinked(999);

      expect(subscriptionModel.updateStatus).toHaveBeenCalledWith(10, 'ACTIVE', {
        current_period_start: expect.any(Date),
        current_period_end: expect.any(Date),
      });
      expect(tenantModel.updateTier).toHaveBeenCalledWith(1, 'STARTER', 200);
      expect(tenantEventModel.create).toHaveBeenCalledWith(1, 'SUBSCRIPTION_ACTIVATED', { subscriptionId: 10, tier: 'STARTER' });
      expect(result).toEqual({ id: 10, status: 'ACTIVE' });
    });
  });

  describe('linkInvoice', () => {
    const accessKey = '1234567890123456789012345678901234567890123456789';

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
  });
});
