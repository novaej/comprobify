const crypto = require('crypto');
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

// ---------------------------------------------------------------------------
// Session creation

// Payphone wants integer cents and enforces
//   amount = amountWithoutTax + amountWithTax + tax + service + tip
// Our columns are DECIMAL(14,2). Rounding total and IVA independently can break
// that identity by a cent, so amountWithTax is DERIVED from the other two
// rather than rounded on its own.
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

  // Mirrors submitPaymentProof's guard — once a payment is settled, no further
  // attempt of any method is accepted for it.
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

  // Short and opaque, not the payment UUID: retries get distinct ids, and
  // nothing about our id scheme leaks to the vendor. 16 chars, well under
  // Cajita's 50-char cap.
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
    reference: `Comprobify ${payment.purpose}`,
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

// Phase one: claim the attempt, ask Payphone, persist the answer, commit.
// Deliberately its own transaction so the lock is released before the
// (slower, multi-table) apply work runs.
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

    // Already resolved — a replayed return page. Return the stored outcome and
    // make no second Payphone call.
    if (attempt.status !== 'PENDING') {
      await client.query('COMMIT');
      return { status: attempt.status, attempt };
    }

    const result = await payphoneService.confirm({ id: payphoneId, clientTxId: clientTransactionId });

    // Transport failure: the charge's real state is unknown. Leave the row
    // PENDING for reconciliation — marking it terminal here would strand money.
    if (!result.ok && result.error) {
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
      raw_confirm_response:    body,
      confirmed_at:            new Date(),
    };

    if (body.statusCode !== STATUS_APPROVED) {
      // Declined or cancelled. Not a rejection of the payment — the tenant can
      // simply request a fresh session and try again, so payments.status stays
      // PENDING and no notification fires.
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

    // Someone already paid this. Two tabs, two sessions, two real charges —
    // apply once, flag the other for a manual refund.
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

// Phase two: turn a captured charge into access. Mirrors reviewPayment's
// VERIFIED tail exactly (subscription.service.js) — same order, same events,
// same notification.
//
// TWO-PHASE GAP: the vendor outcome is already committed by the time this runs,
// so a crash here leaves money captured and the payment still PENDING.
// applied_at is what records that this half finished; reconcileStale() re-runs
// anything APPROVED with applied_at IS NULL. Threading the confirm transaction's
// client all the way through applyVerifiedPayment would close the gap properly,
// but it reaches tenantModel/tenantQuotaService/tenantEventModel/
// notificationService/pricingService, none of which take a client.
async function applyApprovedTransaction(attempt) {
  const payment = await paymentModel.findById(attempt.payment_id);
  if (!payment) throw new NotFoundError('Payment', ErrorCodes.PAYMENT_NOT_FOUND);

  // Idempotence for the reconciliation path: if the payment already settled,
  // only the bookkeeping stamp is missing.
  if (payment.status === 'VERIFIED') {
    return payphoneTransactionModel.updateStatus(attempt.id, attempt.status, { applied_at: new Date() });
  }

  const updatedPayment = await paymentModel.updateStatus(payment.id, 'VERIFIED', { verified_at: new Date() });

  // Re-fetched deliberately, and BEFORE anything mutates it: applyVerifiedPayment
  // snapshots this row into payments.applied_from, which is what refundPayment
  // reverses. A post-mutation subscription here would corrupt every later refund.
  const subscription = await subscriptionModel.findById(payment.subscription_id);
  if (!subscription) throw new NotFoundError('Subscription', ErrorCodes.SUBSCRIPTION_NOT_FOUND);

  const updatedSubscription = await subscriptionService.applyVerifiedPayment(updatedPayment, subscription);

  await tenantEventModel.create(subscription.tenant_id, 'PAYMENT_VERIFIED', { paymentId: payment.id });
  await notificationService.createPaymentReviewed(updatedPayment, updatedSubscription, 'VERIFIED');

  const stamped = await payphoneTransactionModel.updateStatus(attempt.id, attempt.status, { applied_at: new Date() });

  // Nobody clicked "verify" for a card payment, so without this the operator
  // has no signal that an invoice is now owed.
  const effect = await pendingEffectService.enqueue(
    EffectTypes.PAYMENT_VERIFIED_OPERATOR_EMAIL,
    subscription.tenant_id,
    { paymentId: payment.id, subscriptionId: subscription.id, tenantId: subscription.tenant_id }
  );
  pendingEffectService.dispatch(effect);

  return stamped;
}

// A duplicate charge is real money that needs refunding by hand in the Payphone
// dashboard (reversal detection/automation is deliberately out of scope — see
// ADR-027), so it is raised on every channel the operator watches.
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

  // Sweep 1: outcomes we never learned. The payer closed the browser before the
  // return page loaded, so confirm never fired — Payphone will have auto-
  // reversed at 5 minutes, but we still need to record which way it went.
  const stale = await payphoneTransactionModel.findStalePending(STALE_PENDING_MINUTES);
  for (const attempt of stale) {
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
      raw_confirm_response:    body,
      confirmed_at:            new Date(),
    });
    resolved++;
  }

  // Sweep 2: charges captured but never applied — the two-phase gap above, plus
  // anything sweep 1 just discovered was actually approved.
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
