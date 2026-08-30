jest.mock('../../../src/config/database');
jest.mock('../../../src/models/payphone-transaction.model');
jest.mock('../../../src/models/payment.model');
jest.mock('../../../src/models/subscription.model');
jest.mock('../../../src/models/tenant-event.model');
jest.mock('../../../src/services/payphone.service');
jest.mock('../../../src/services/subscription.service');
jest.mock('../../../src/services/notification.service');
jest.mock('../../../src/services/pending-effect.service');
jest.mock('../../../src/services/logger.service');
jest.mock('@sentry/node');

const db = require('../../../src/config/database');
const payphoneTransactionModel = require('../../../src/models/payphone-transaction.model');
const paymentModel = require('../../../src/models/payment.model');
const subscriptionModel = require('../../../src/models/subscription.model');
const tenantEventModel = require('../../../src/models/tenant-event.model');
const payphoneService = require('../../../src/services/payphone.service');
const subscriptionService = require('../../../src/services/subscription.service');
const notificationService = require('../../../src/services/notification.service');
const pendingEffectService = require('../../../src/services/pending-effect.service');
const Sentry = require('@sentry/node');
const config = require('../../../src/config');
const payphonePaymentService = require('../../../src/services/payphone-payment.service');

const TENANT = '00000000-0000-0000-0000-000000000001';
const SUB = '00000000-0000-0000-0000-000000000010';
const PAY = '00000000-0000-0000-0000-000000000020';
const ATTEMPT = '00000000-0000-0000-0000-000000000030';
const CTX = 'a1b2c3d4e5f60718';

const originalPayphone = { ...config.payphone };

// $20.00 all-in, $2.61 IVA -> 2000 cents total, 261 tax, 1739 base
const payment = (over = {}) => ({
  id: PAY, subscription_id: SUB, status: 'PENDING', purpose: 'INITIAL',
  total_amount: '20.00', iva_amount: '2.61', ...over,
});
const attempt = (over = {}) => ({
  id: ATTEMPT, payment_id: PAY, client_transaction_id: CTX,
  status: 'PENDING', amount_cents: 2000, ...over,
});

let mockClient;

describe('payphonePaymentService', () => {
  beforeEach(() => {
    config.payphone.token = 'tok';
    config.payphone.storeId = 'store';
    payphoneService.isConfigured.mockReturnValue(true);

    mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    db.getClient.mockResolvedValue(mockClient);

    payphoneTransactionModel.create.mockResolvedValue(attempt());
    payphoneTransactionModel.updateStatus.mockImplementation(async (id, status) => attempt({ status }));
    paymentModel.updateMethod.mockResolvedValue(payment());
    pendingEffectService.enqueue.mockResolvedValue({ id: 'e1' });
    pendingEffectService.dispatch.mockResolvedValue();
  });

  afterEach(() => {
    Object.assign(config.payphone, originalPayphone);
    jest.clearAllMocks();
  });

  describe('toAmountBreakdown', () => {
    test('splits an all-in total into the identity Payphone enforces', () => {
      const b = payphonePaymentService.toAmountBreakdown(payment());

      expect(b).toEqual({ amount: 2000, tax: 261, amountWithTax: 1739, amountWithoutTax: 0, service: 0, tip: 0 });
      expect(b.amountWithoutTax + b.amountWithTax + b.tax + b.service + b.tip).toBe(b.amount);
    });

    // The reason amountWithTax is derived rather than rounded independently:
    // rounding both halves separately can leave the sum a cent off.
    test.each([
      ['20.00', '2.61'], ['90.00', '11.74'], ['0.03', '0.01'], ['230.00', '30.00'], ['2300.00', '300.00'],
    ])('the identity holds for total=%s iva=%s', (total_amount, iva_amount) => {
      const b = payphonePaymentService.toAmountBreakdown(payment({ total_amount, iva_amount }));
      expect(b.amountWithoutTax + b.amountWithTax + b.tax + b.service + b.tip).toBe(b.amount);
    });
  });

  describe('createSession', () => {
    test('503s when Payphone is not configured, leaving SPI untouched', async () => {
      payphoneService.isConfigured.mockReturnValue(false);

      await expect(payphonePaymentService.createSession(PAY, TENANT))
        .rejects.toMatchObject({ statusCode: 503, code: 'PAYMENT_GATEWAY_NOT_CONFIGURED' });
      expect(payphoneTransactionModel.create).not.toHaveBeenCalled();
    });

    test('404s for a payment belonging to another tenant', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue(null);

      await expect(payphonePaymentService.createSession(PAY, TENANT))
        .rejects.toMatchObject({ statusCode: 404 });
    });

    test('refuses a payment that is already verified', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue(payment({ status: 'VERIFIED' }));

      await expect(payphonePaymentService.createSession(PAY, TENANT))
        .rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_ALREADY_VERIFIED' });
    });

    // Payphone rejects anything under $1.00 (errorCode 107), verified against
    // their live test store. Reachable in practice: a prorated upgrade with a
    // few hours left in the period. Caught here so the frontend can offer bank
    // transfer, rather than at the widget as an untranslatable vendor error.
    test.each([['0.99'], ['0.03'], ['0.01']])(
      'refuses a card session for a $%s total, below Payphone\'s minimum',
      async (total_amount) => {
        paymentModel.findByIdAndTenantId.mockResolvedValue(payment({ total_amount, iva_amount: '0.00' }));

        await expect(payphonePaymentService.createSession(PAY, TENANT))
          .rejects.toMatchObject({ statusCode: 400, code: 'PAYPHONE_AMOUNT_BELOW_MINIMUM' });
        expect(payphoneTransactionModel.create).not.toHaveBeenCalled();
        expect(paymentModel.updateMethod).not.toHaveBeenCalled();
      }
    );

    test('accepts exactly $1.00, the documented minimum', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue(payment({ total_amount: '1.00', iva_amount: '0.13' }));

      const session = await payphonePaymentService.createSession(PAY, TENANT);

      expect(session.amount).toBe(100);
    });

    // APP_ENV is 'staging' both locally and on the droplet, so the hostname is
    // what actually tells the two apart in Payphone's console.
    describe('reference', () => {
      const origEnv = config.appEnv;
      afterEach(() => { config.appEnv = origEnv; });

      test('carries the hostname outside production, to identify which machine paid', async () => {
        config.appEnv = 'staging';
        paymentModel.findByIdAndTenantId.mockResolvedValue(payment());

        const session = await payphonePaymentService.createSession(PAY, TENANT);

        expect(session.reference).toBe(`Comprobify INITIAL · ${require('os').hostname()}`);
      });

      // It shows on the payer's receipt, so a real customer must never see it.
      test('omits the hostname in production', async () => {
        config.appEnv = 'production';
        paymentModel.findByIdAndTenantId.mockResolvedValue(payment());

        const session = await payphonePaymentService.createSession(PAY, TENANT);

        expect(session.reference).toBe('Comprobify INITIAL');
      });

      test("stays within Payphone's 100-char cap", async () => {
        config.appEnv = 'staging';
        jest.spyOn(require('os'), 'hostname').mockReturnValue('x'.repeat(200));
        paymentModel.findByIdAndTenantId.mockResolvedValue(payment());

        const session = await payphonePaymentService.createSession(PAY, TENANT);

        expect(session.reference.length).toBe(100);
        require('os').hostname.mockRestore();
      });
    });

    test('mints an opaque clientTransactionId, not the payment id', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue(payment());

      const session = await payphonePaymentService.createSession(PAY, TENANT);

      expect(session.clientTransactionId).toMatch(/^[0-9a-f]{16}$/);
      expect(session.clientTransactionId).not.toBe(PAY);
      expect(session.clientTransactionId.length).toBeLessThanOrEqual(50); // Cajita cap
    });

    test('returns the widget config and flags the payment as card-paid', async () => {
      paymentModel.findByIdAndTenantId.mockResolvedValue(payment());

      const session = await payphonePaymentService.createSession(PAY, TENANT);

      expect(session).toMatchObject({ token: 'tok', storeId: 'store', currency: 'USD', amount: 2000, tax: 261 });
      expect(paymentModel.updateMethod).toHaveBeenCalledWith(PAY, 'PAYPHONE_CARD');
      expect(payphoneTransactionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: PAY, amountCents: 2000 })
      );
    });
  });

  describe('confirmTransaction', () => {
    const confirmArgs = { payphoneId: 987, clientTransactionId: CTX, tenantId: TENANT };

    const approvedBody = { statusCode: 3, amount: 2000, transactionId: 987, authorizationCode: 'W1', cardBrand: 'Visa', lastDigits: 'XX17' };

    function wireApplyPath() {
      paymentModel.findById.mockResolvedValue(payment());
      paymentModel.updateStatus.mockResolvedValue(payment({ status: 'VERIFIED' }));
      subscriptionModel.findById.mockResolvedValue({ id: SUB, tenant_id: TENANT, tier: 'STARTER', status: 'PENDING_PAYMENT' });
      subscriptionService.applyVerifiedPayment.mockResolvedValue({ id: SUB, status: 'ACTIVE' });
      notificationService.createPaymentReviewed.mockResolvedValue({});
    }

    test('404s when no attempt matches the clientTransactionId', async () => {
      payphoneTransactionModel.claimByClientTransactionId.mockResolvedValue(null);

      await expect(payphonePaymentService.confirmTransaction(confirmArgs))
        .rejects.toMatchObject({ statusCode: 404, code: 'PAYPHONE_SESSION_NOT_FOUND' });
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    test("404s when the attempt's payment belongs to another tenant", async () => {
      payphoneTransactionModel.claimByClientTransactionId.mockResolvedValue(attempt());
      paymentModel.findByIdAndTenantId.mockResolvedValue(null);

      await expect(payphonePaymentService.confirmTransaction(confirmArgs))
        .rejects.toMatchObject({ statusCode: 404, code: 'PAYPHONE_SESSION_NOT_FOUND' });
      expect(payphoneService.confirm).not.toHaveBeenCalled();
    });

    // The replayed-return-page case: the whole reason the row is claimed FOR UPDATE.
    test('an already-terminal attempt returns the stored outcome and makes NO second Payphone call', async () => {
      payphoneTransactionModel.claimByClientTransactionId.mockResolvedValue(attempt({ status: 'APPROVED' }));
      paymentModel.findByIdAndTenantId.mockResolvedValue(payment({ status: 'VERIFIED' }));
      paymentModel.findById.mockResolvedValue(payment({ status: 'VERIFIED' }));

      const result = await payphonePaymentService.confirmTransaction(confirmArgs);

      expect(result.status).toBe('APPROVED');
      expect(payphoneService.confirm).not.toHaveBeenCalled();
      expect(subscriptionService.applyVerifiedPayment).not.toHaveBeenCalled();
    });

    // Critical: an unresolved charge must never look like a decline.
    test('a transport failure leaves the attempt PENDING and does NOT mark it terminal', async () => {
      payphoneTransactionModel.claimByClientTransactionId.mockResolvedValue(attempt());
      paymentModel.findByIdAndTenantId.mockResolvedValue(payment());
      payphoneService.confirm.mockResolvedValue({ ok: false, error: 'ECONNRESET' });

      await expect(payphonePaymentService.confirmTransaction(confirmArgs))
        .rejects.toMatchObject({ statusCode: 502, code: 'PAYPHONE_CONFIRM_FAILED' });

      const [, status] = payphoneTransactionModel.updateStatus.mock.calls[0];
      expect(status).toBe('PENDING');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    // Without the id persisted here, reconciliation has nothing to look the
    // charge up by — and a charge Payphone captured but never acknowledged to
    // us would be marked EXPIRED and lost.
    test('a transport failure still records Payphone\'s id so it can be recovered later', async () => {
      payphoneTransactionModel.claimByClientTransactionId.mockResolvedValue(attempt());
      paymentModel.findByIdAndTenantId.mockResolvedValue(payment());
      payphoneService.confirm.mockResolvedValue({ ok: false, error: 'ECONNRESET' });

      await expect(payphonePaymentService.confirmTransaction(confirmArgs)).rejects.toThrow();

      expect(payphoneTransactionModel.updateStatus).toHaveBeenCalledWith(
        ATTEMPT, 'PENDING', { payphone_transaction_id: 987 }, mockClient
      );
    });

    test('a declined charge marks the attempt CANCELLED and leaves the payment PENDING', async () => {
      payphoneTransactionModel.claimByClientTransactionId.mockResolvedValue(attempt());
      paymentModel.findByIdAndTenantId.mockResolvedValue(payment());
      payphoneService.confirm.mockResolvedValue({ ok: true, statusCode: 200, body: { statusCode: 2 } });

      const result = await payphonePaymentService.confirmTransaction(confirmArgs);

      expect(result.status).toBe('CANCELLED');
      expect(payphoneTransactionModel.updateStatus).toHaveBeenCalledWith(ATTEMPT, 'CANCELLED', expect.any(Object), mockClient);
      expect(paymentModel.updateStatus).not.toHaveBeenCalled();
      expect(notificationService.createPaymentReviewed).not.toHaveBeenCalled();
    });

    test('never trusts the amount Payphone echoes back', async () => {
      payphoneTransactionModel.claimByClientTransactionId.mockResolvedValue(attempt());
      paymentModel.findByIdAndTenantId.mockResolvedValue(payment());
      payphoneService.confirm.mockResolvedValue({ ok: true, statusCode: 200, body: { ...approvedBody, amount: 100 } });

      const result = await payphonePaymentService.confirmTransaction(confirmArgs);

      expect(result.status).toBe('ERROR');
      expect(subscriptionService.applyVerifiedPayment).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).toHaveBeenCalled();
    });

    test('an approved charge applies the payment and grants the tier', async () => {
      payphoneTransactionModel.claimByClientTransactionId.mockResolvedValue(attempt());
      paymentModel.findByIdAndTenantId.mockResolvedValue(payment());
      payphoneService.confirm.mockResolvedValue({ ok: true, statusCode: 200, body: approvedBody });
      wireApplyPath();

      const result = await payphonePaymentService.confirmTransaction(confirmArgs);

      expect(result.status).toBe('APPROVED');
      expect(paymentModel.updateStatus).toHaveBeenCalledWith(PAY, 'VERIFIED', { verified_at: expect.any(Date) });
      expect(subscriptionService.applyVerifiedPayment).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'VERIFIED' }),
        expect.objectContaining({ id: SUB, status: 'PENDING_PAYMENT' }), // pre-mutation
      );
      expect(tenantEventModel.create).toHaveBeenCalledWith(TENANT, 'PAYMENT_VERIFIED', { paymentId: PAY });
      expect(notificationService.createPaymentReviewed).toHaveBeenCalled();
    });

    test('stamps applied_at and enqueues the operator email once applied', async () => {
      payphoneTransactionModel.claimByClientTransactionId.mockResolvedValue(attempt());
      paymentModel.findByIdAndTenantId.mockResolvedValue(payment());
      payphoneService.confirm.mockResolvedValue({ ok: true, statusCode: 200, body: approvedBody });
      wireApplyPath();

      await payphonePaymentService.confirmTransaction(confirmArgs);

      expect(payphoneTransactionModel.updateStatus).toHaveBeenCalledWith(
        ATTEMPT, expect.any(String), { applied_at: expect.any(Date) }
      );
      expect(pendingEffectService.enqueue).toHaveBeenCalledWith(
        'PAYMENT_VERIFIED_OPERATOR_EMAIL', TENANT, expect.objectContaining({ paymentId: PAY })
      );
    });

    // Two tabs, two sessions, two real charges. Applying twice would
    // double-extend a period or double-flip a tier.
    test('a second approved charge for an already-paid payment is flagged DUPLICATE, never applied', async () => {
      payphoneTransactionModel.claimByClientTransactionId.mockResolvedValue(attempt());
      paymentModel.findByIdAndTenantId.mockResolvedValue(payment({ status: 'VERIFIED' }));
      payphoneService.confirm.mockResolvedValue({ ok: true, statusCode: 200, body: approvedBody });

      const result = await payphonePaymentService.confirmTransaction(confirmArgs);

      expect(result.status).toBe('DUPLICATE');
      expect(subscriptionService.applyVerifiedPayment).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate'), expect.objectContaining({ level: 'error' })
      );
    });
  });

  describe('reconcileStaleTransactions', () => {
    // No vendor id means the return page never reached us. Payphone auto-reversed
    // at 5 minutes, so there is nothing to ask about and nothing to recover.
    test('expires an attempt with no vendor id without calling Payphone at all', async () => {
      payphoneTransactionModel.findStalePending.mockResolvedValue([attempt({ payphone_transaction_id: null })]);
      payphoneTransactionModel.findApprovedUnapplied.mockResolvedValue([]);

      const result = await payphonePaymentService.reconcileStaleTransactions();

      expect(payphoneService.confirm).not.toHaveBeenCalled();
      expect(payphoneTransactionModel.updateStatus).toHaveBeenCalledWith(
        ATTEMPT, 'EXPIRED', { confirmed_at: expect.any(Date) }
      );
      expect(result.payphoneOutcomesResolved).toBe(1);
    });

    // The recovery this whole mechanism exists for: the charge was captured but
    // our confirm's response was lost, so the tenant was never credited.
    test('recovers a captured charge whose confirm response was lost in transit', async () => {
      payphoneTransactionModel.findStalePending.mockResolvedValue([attempt({ payphone_transaction_id: 987 })]);
      payphoneTransactionModel.findApprovedUnapplied.mockResolvedValue([]);
      payphoneService.confirm.mockResolvedValue({
        ok: true, statusCode: 200, body: { statusCode: 3, amount: 2000, transactionId: 987 },
      });

      const result = await payphonePaymentService.reconcileStaleTransactions();

      expect(payphoneService.confirm).toHaveBeenCalledWith({ id: 987, clientTxId: CTX });
      expect(payphoneTransactionModel.updateStatus).toHaveBeenCalledWith(
        ATTEMPT, 'APPROVED', expect.any(Object)
      );
      expect(result.payphoneOutcomesResolved).toBe(1);
    });

    test('resolves a stale PENDING attempt Payphone reports as never captured', async () => {
      payphoneTransactionModel.findStalePending.mockResolvedValue([attempt({ payphone_transaction_id: 987 })]);
      payphoneTransactionModel.findApprovedUnapplied.mockResolvedValue([]);
      payphoneService.confirm.mockResolvedValue({ ok: true, statusCode: 400, body: { statusCode: 2 } });

      const result = await payphonePaymentService.reconcileStaleTransactions();

      expect(payphoneTransactionModel.updateStatus).toHaveBeenCalledWith(ATTEMPT, 'EXPIRED', expect.any(Object));
      expect(result.payphoneOutcomesResolved).toBe(1);
    });

    test('leaves a still-unreachable attempt PENDING for the next tick', async () => {
      payphoneTransactionModel.findStalePending.mockResolvedValue([attempt({ payphone_transaction_id: 987 })]);
      payphoneTransactionModel.findApprovedUnapplied.mockResolvedValue([]);
      payphoneService.confirm.mockResolvedValue({ ok: false, error: 'ETIMEDOUT' });

      const result = await payphonePaymentService.reconcileStaleTransactions();

      expect(payphoneTransactionModel.updateStatus).not.toHaveBeenCalled();
      expect(result.payphoneOutcomesResolved).toBe(0);
    });

    // The two-phase gap: money captured, process died before granting access.
    test('applies an APPROVED attempt that was never applied', async () => {
      payphoneTransactionModel.findStalePending.mockResolvedValue([]);
      payphoneTransactionModel.findApprovedUnapplied.mockResolvedValue([attempt({ status: 'APPROVED' })]);
      paymentModel.findById.mockResolvedValue(payment());
      paymentModel.updateStatus.mockResolvedValue(payment({ status: 'VERIFIED' }));
      subscriptionModel.findById.mockResolvedValue({ id: SUB, tenant_id: TENANT, tier: 'STARTER', status: 'PENDING_PAYMENT' });
      subscriptionService.applyVerifiedPayment.mockResolvedValue({ id: SUB, status: 'ACTIVE' });
      notificationService.createPaymentReviewed.mockResolvedValue({});

      const result = await payphonePaymentService.reconcileStaleTransactions();

      expect(subscriptionService.applyVerifiedPayment).toHaveBeenCalled();
      expect(result.payphoneChargesApplied).toBe(1);
    });

    // Idempotence: re-running must not double-apply an already-settled payment.
    test('an APPROVED attempt whose payment already settled only gets its stamp', async () => {
      payphoneTransactionModel.findStalePending.mockResolvedValue([]);
      payphoneTransactionModel.findApprovedUnapplied.mockResolvedValue([attempt({ status: 'APPROVED' })]);
      paymentModel.findById.mockResolvedValue(payment({ status: 'VERIFIED' }));

      await payphonePaymentService.reconcileStaleTransactions();

      expect(subscriptionService.applyVerifiedPayment).not.toHaveBeenCalled();
      expect(payphoneTransactionModel.updateStatus).toHaveBeenCalledWith(
        ATTEMPT, 'APPROVED', { applied_at: expect.any(Date) }
      );
    });

    test('one failing apply does not abort the rest of the sweep', async () => {
      payphoneTransactionModel.findStalePending.mockResolvedValue([]);
      payphoneTransactionModel.findApprovedUnapplied.mockResolvedValue([
        attempt({ id: 'bad', status: 'APPROVED' }),
        attempt({ id: 'good', status: 'APPROVED' }),
      ]);
      paymentModel.findById
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(payment({ status: 'VERIFIED' }));

      const result = await payphonePaymentService.reconcileStaleTransactions();

      expect(result.payphoneChargesApplied).toBe(1);
    });
  });
});
