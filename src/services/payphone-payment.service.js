const crypto = require('crypto');
const os = require('os');
const Sentry = require('@sentry/node');
const db = require('../config/database');
const payphoneTransactionModel = require('../models/payphone-transaction.model');
const paymentModel = require('../models/payment.model');
const subscriptionModel = require('../models/subscription.model');
const payphoneService = require('./payphone.service');
const subscriptionService = require('./subscription.service');
const notificationService = require('./notification.service');
const pendingEffectService = require('./pending-effect.service');
const tenantEventModel = require('../models/tenant-event.model');
const logger = require('./logger.service');
const { EffectTypes } = require('../constants/effect-types');
const PaymentMethods = require('../constants/payment-methods');
const config = require('../config');
const AppError = require('../errors/app-error');
const ConflictError = require('../errors/conflict-error');
const NotFoundError = require('../errors/not-found-error');
const ErrorCodes = require('../constants/error-codes');

// Payphone's approved status code. 2 is cancelled; anything else is a failure.
const STATUS_APPROVED = 3;

// How long an attempt may sit PENDING before reconciliation chases it. Payphone
// auto-reverses at 5 minutes, so by 10 the outcome is settled either way.
const STALE_PENDING_MINUTES = 10;

// Payphone rejects charges under $1.00 (errorCode 107). Reachable via a
// prorated upgrade with little time left in the period.
const MIN_CHARGE_CENTS = 100;

// A frontend that re-mints on every widget open shouldn't grow this unboundedly.
// Mirrors MAX_ACTIVE_PROOFS_PER_PAYMENT. Attempts are never reused: we can't
// tell whether Payphone already saw a clientTransactionId, so each session gets
// a fresh one.
const MAX_PENDING_ATTEMPTS_PER_PAYMENT = 10;

// Payphone caps reference at 100 chars.
const MAX_REFERENCE_CHARS = 100;

// APP_ENV is 'staging' both locally and on the droplet, so the hostname is what
// actually separates them in Payphone's console — same reason logger.service.js
// stamps it. Never appended in production: this shows on the payer's receipt.
function buildReference(payment) {
  const base = `Comprobify ${payment.purpose}`;
  if (config.appEnv === 'production') return base;
  return `${base} · ${os.hostname()}`.slice(0, MAX_REFERENCE_CHARS);
}

// ---------------------------------------------------------------------------
// Session creation

// Payphone enforces amount = amountWithoutTax + amountWithTax + tax + service
// + tip, so amountWithTax is derived — rounding both halves can break it a cent.
function toAmountBreakdown(payment) {
  const amount = Math.round(Number(payment.total_amount) * 100);
  const tax = Math.round(Number(payment.iva_amount) * 100);
  const amountWithTax = amount - tax;

  if (amountWithTax < 0 || amountWithTax + tax !== amount) {
    throw new AppError('Payment amounts could not be expressed as a valid Payphone breakdown', 500);
  }

  return { amount, tax, amountWithTax, amountWithoutTax: 0, service: 0, tip: 0 };
}

/**
 * Mints a card-payment session for one of the tenant's own payments. The
 * response is fed straight into Payphone's browser widget.
 */
async function createSession(paymentId, tenantId) {
  if (!payphoneService.isConfigured()) {
    throw new AppError(
      'Card payments are not available in this environment. Use a bank transfer instead.',
      503,
      ErrorCodes.PAYMENT_GATEWAY_NOT_CONFIGURED
    );
  }

  const payment = await paymentModel.findByIdAndTenantId(paymentId, tenantId);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  // Once settled, no further attempt of any method is accepted.
  if (payment.status === 'VERIFIED') {
    throw new ConflictError(
      'Payment has already been verified and can no longer accept a card payment',
      ErrorCodes.PAYMENT_ALREADY_VERIFIED
    );
  }
  if (payment.status === 'REFUNDED') {
    throw new ConflictError(
      'Payment has been refunded and can no longer accept a card payment',
      ErrorCodes.PAYMENT_ALREADY_VERIFIED
    );
  }

  const breakdown = toAmountBreakdown(payment);

  // Caught here so the frontend can offer bank transfer instead of a vendor
  // error the tenant can't act on.
  if (breakdown.amount < MIN_CHARGE_CENTS) {
    throw new AppError(
      `Card payments require a total of at least $${(MIN_CHARGE_CENTS / 100).toFixed(2)}. Pay this one by bank transfer instead.`,
      400,
      ErrorCodes.PAYPHONE_AMOUNT_BELOW_MINIMUM
    );
  }

  const livePending = await payphoneTransactionModel.countPendingByPaymentId(payment.id);
  if (livePending >= MAX_PENDING_ATTEMPTS_PER_PAYMENT) {
    throw new ConflictError(
      `This payment already has ${livePending} unresolved card attempts. Wait for them to settle, or pay by bank transfer.`,
      ErrorCodes.PAYPHONE_TOO_MANY_ATTEMPTS
    );
  }

  // Not the payment UUID: retries get distinct ids. 16 chars, under the 50 cap.
  const clientTransactionId = crypto.randomBytes(8).toString('hex');

  const attempt = await payphoneTransactionModel.create({
    paymentId: payment.id,
    clientTransactionId,
    amountCents: breakdown.amount,
  });

  await paymentModel.updateMethod(payment.id, PaymentMethods.PAYPHONE_CARD);

  return {
    clientTransactionId,
    attemptId: attempt.id,
    // Everything below is the widget's own init config, passed through as-is.
    token:   config.payphone.token,
    storeId: config.payphone.storeId,
    currency: 'USD',
    reference: buildReference(payment),
    ...breakdown,
  };
}

// ---------------------------------------------------------------------------
// Confirmation — the money path

/**
 * Confirms a charge with Payphone and, if approved, applies the payment.
 *
 * Must run within 5 minutes of the payer completing the widget or Payphone
 * auto-reverses the charge. See docs/guides/payphone-payments.md.
 */
async function confirmTransaction({ payphoneId, clientTransactionId, tenantId }) {
  if (!payphoneService.isConfigured()) {
    throw new AppError(
      'Card payments are not available in this environment.',
      503,
      ErrorCodes.PAYMENT_GATEWAY_NOT_CONFIGURED
    );
  }

  const outcome = await resolveOutcome({ payphoneId, clientTransactionId, tenantId });

  // Applying happens AFTER the vendor outcome is committed — see the
  // "two-phase" note in applyApprovedTransaction.
  if (outcome.status === 'APPROVED') {
    await applyApprovedTransaction(outcome.attempt);
  }

  return { status: outcome.status, clientTransactionId };
}

// Phase one: claim, ask Payphone, persist, commit. Its own transaction so the
// lock releases before the slower apply work.
async function resolveOutcome({ payphoneId, clientTransactionId, tenantId }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const attempt = await payphoneTransactionModel.claimByClientTransactionId(client, clientTransactionId);
    if (!attempt) {
      await client.query('ROLLBACK');
      throw new NotFoundError('Card payment attempt', ErrorCodes.PAYPHONE_SESSION_NOT_FOUND);
    }

    // Ownership: the attempt's payment must belong to the calling tenant.
    const payment = await paymentModel.findByIdAndTenantId(attempt.payment_id, tenantId);
    if (!payment) {
      await client.query('ROLLBACK');
      throw new NotFoundError('Card payment attempt', ErrorCodes.PAYPHONE_SESSION_NOT_FOUND);
    }

    // Replayed return page: return the stored outcome, no second vendor call.
    if (attempt.status !== 'PENDING') {
      await client.query('COMMIT');
      return { status: attempt.status, attempt };
    }

    const result = await payphoneService.confirm({ id: payphoneId, clientTxId: clientTransactionId });

    // State unknown: leave PENDING. Marking it terminal would strand money.
    // Persist Payphone's id though — without it a later sweep has nothing to
    // look the charge up by, and a captured-but-unacknowledged charge is lost.
    if (!result.ok && result.error) {
      await payphoneTransactionModel.updateStatus(attempt.id, 'PENDING', {
        payphone_transaction_id: payphoneId,
      }, client);
      await client.query('COMMIT');
      logger.warn('payphone confirm transport failure', {
        clientTransactionId, error: result.error,
      });
      throw new AppError(
        'Could not confirm the payment with Payphone. It will be reconciled automatically shortly.',
        502,
        ErrorCodes.PAYPHONE_CONFIRM_FAILED
      );
    }

    const body = result.body || {};
    const common = {
      payphone_transaction_id: body.transactionId ?? null,
      status_code:             body.statusCode ?? null,
      authorization_code:      body.authorizationCode ?? null,
      card_brand:              body.cardBrand ?? null,
      card_last_digits:        body.lastDigits ?? null,
      confirm_response:    body,
      confirmed_at:            new Date(),
    };

    if (body.statusCode !== STATUS_APPROVED) {
      // Not a rejection: the tenant can request a fresh session, so the payment
      // stays PENDING and no notification fires.
      const updated = await payphoneTransactionModel.updateStatus(attempt.id, 'CANCELLED', common, client);
      await client.query('COMMIT');
      return { status: 'CANCELLED', attempt: updated };
    }

    // Never trust the amount Payphone echoes back.
    if (Number(body.amount) !== attempt.amount_cents) {
      const updated = await payphoneTransactionModel.updateStatus(attempt.id, 'ERROR', common, client);
      await client.query('COMMIT');
      logger.error('payphone confirmed a mismatched amount', {
        clientTransactionId, expectedCents: attempt.amount_cents, receivedCents: body.amount,
      });
      Sentry.captureMessage('Payphone confirmed a mismatched amount', {
        level: 'error',
        extra: { clientTransactionId, expected: attempt.amount_cents, received: body.amount },
      });
      return { status: 'ERROR', attempt: updated };
    }

    // Two tabs, two real charges: apply once, flag the other for refund.
    if (payment.status === 'VERIFIED') {
      const updated = await payphoneTransactionModel.updateStatus(attempt.id, 'DUPLICATE', common, client);
      await client.query('COMMIT');
      await reportDuplicateCharge(payment, updated);
      return { status: 'DUPLICATE', attempt: updated };
    }

    const updated = await payphoneTransactionModel.updateStatus(attempt.id, 'APPROVED', common, client);
    await client.query('COMMIT');
    return { status: 'APPROVED', attempt: updated };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Phase two: mirrors reviewPayment's VERIFIED tail. The vendor outcome is
// already committed, so a crash here leaves money captured and the payment
// PENDING — applied_at marks this half done, and reconciliation re-runs it.
async function applyApprovedTransaction(attempt) {
  const payment = await paymentModel.findById(attempt.payment_id);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  // Idempotent: an already-settled payment only needs the stamp.
  if (payment.status === 'VERIFIED') {
    return payphoneTransactionModel.updateStatus(attempt.id, attempt.status, { applied_at: new Date() });
  }

  const updatedPayment = await paymentModel.updateStatus(payment.id, 'VERIFIED', { verified_at: new Date() });

  // Must be pre-mutation: applyVerifiedPayment snapshots it into applied_from,
  // which refundPayment reverses.
  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (!subscription) throw new NotFoundError('Subscription', ErrorCodes.SUBSCRIPTION_NOT_FOUND);

  const updatedSubscription = await subscriptionService.applyVerifiedPayment(updatedPayment, subscription);

  await tenantEventModel.create(subscription.tenant_id, 'PAYMENT_VERIFIED', { paymentId: payment.id });
  await notificationService.createPaymentReviewed(updatedPayment, updatedSubscription, 'VERIFIED');

  const stamped = await payphoneTransactionModel.updateStatus(attempt.id, attempt.status, { applied_at: new Date() });

  // Nobody clicked "verify" here, so nothing else tells the operator.
  const effect = await pendingEffectService.enqueue(
    EffectTypes.PAYMENT_VERIFIED_OPERATOR_EMAIL,
    subscription.tenant_id,
    { paymentId: payment.id, subscriptionId: subscription.id, tenantId: subscription.tenant_id }
  );
  pendingEffectService.dispatch(effect);

  return stamped;
}

// Real money needing a manual refund, so raise it everywhere the operator looks.
async function reportDuplicateCharge(payment, attempt) {
  logger.error('duplicate Payphone charge captured', {
    paymentId: payment.id,
    clientTransactionId: attempt.client_transaction_id,
    payphoneTransactionId: attempt.payphone_transaction_id,
    amountCents: attempt.amount_cents,
  });
  Sentry.captureMessage('Duplicate Payphone charge captured — manual refund required', {
    level: 'error',
    extra: {
      paymentId: payment.id,
      clientTransactionId: attempt.client_transaction_id,
      payphoneTransactionId: attempt.payphone_transaction_id,
      amountCents: attempt.amount_cents,
    },
  });
}

// ---------------------------------------------------------------------------
// Reconciliation (POST /v1/admin/jobs/payphone-reconciliation)

async function reconcileStaleTransactions() {
  let resolved = 0;
  let applied = 0;

  // Sweep 1: attempts whose outcome we never learned.
  const stale = await payphoneTransactionModel.findStalePending(STALE_PENDING_MINUTES);
  for (const attempt of stale) {
    // No vendor id means the return page never reached us, so there is nothing
    // to look up — and Payphone auto-reversed at 5 minutes, well before this
    // sweep. Mark it expired rather than making a call that can only fail.
    if (!attempt.payphone_transaction_id) {
      await payphoneTransactionModel.updateStatus(attempt.id, 'EXPIRED', { confirmed_at: new Date() });
      resolved++;
      continue;
    }

    // We do have an id: confirm was attempted and its transport failed, so the
    // charge may have been captured. This retry is what recovers it.
    const result = await payphoneService.confirm({
      id: attempt.payphone_transaction_id, clientTxId: attempt.client_transaction_id,
    });
    if (!result.ok && result.error) continue; // still unreachable; try again next tick

    const body = result.body || {};
    const approved = body.statusCode === STATUS_APPROVED && Number(body.amount) === attempt.amount_cents;
    await payphoneTransactionModel.updateStatus(attempt.id, approved ? 'APPROVED' : 'EXPIRED', {
      payphone_transaction_id: body.transactionId ?? attempt.payphone_transaction_id,
      status_code:             body.statusCode ?? null,
      authorization_code:      body.authorizationCode ?? null,
      confirm_response:    body,
      confirmed_at:            new Date(),
    });
    resolved++;
  }

  // Sweep 2: captured but never applied — the two-phase gap.
  const unapplied = await payphoneTransactionModel.findApprovedUnapplied();
  for (const attempt of unapplied) {
    try {
      await applyApprovedTransaction(attempt);
      applied++;
    } catch (err) {
      logger.error('failed to apply an approved Payphone charge', {
        clientTransactionId: attempt.client_transaction_id, error: err.message,
      });
    }
  }

  return { payphoneOutcomesResolved: resolved, payphoneChargesApplied: applied };
}

module.exports = {
  createSession,
  confirmTransaction,
  reconcileStaleTransactions,
  // Exported for tests — the amount identity is the fiddliest part of the flow.
  toAmountBreakdown,
};
