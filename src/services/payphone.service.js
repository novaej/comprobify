const config = require('../config');

// Payphone's "Cajita de Pagos" vendor client. Confirmation only — the widget
// itself runs in the browser, and the session config it needs is assembled by
// payphone-payment.service.js. See docs/guides/payphone-payments.md.
//
// Payphone auto-reverses any charge not confirmed within 5 minutes, so this
// call is the one that actually captures the money.

/**
 * Confirms a charge with Payphone.
 *
 * **Never throws** — mirrors webhook-delivery.service.js's attemptDelivery for
 * the same reason it does, but the stakes here are higher: the caller must be
 * able to tell "the network failed, so this charge is UNRESOLVED and must be
 * retried" apart from "Payphone says declined, so this attempt is terminal".
 * An exception would collapse those two into one, and treating an unresolved
 * charge as declined would strand real money.
 *
 * Deliberately no in-loop retry (unlike sri.service.js's fetchWithRetry): a
 * tenant's browser is waiting on this, and retrying inside the 5-minute window
 * is the reconciliation job's job.
 *
 * @param {{ id: number|string, clientTxId: string }} params
 * @returns {Promise<{ ok: true, statusCode: number, body: object|null, raw: string }
 *                  | { ok: false, statusCode?: number, body?: object|null, raw?: string, error?: string }>}
 */
async function confirm({ id, clientTxId }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.payphone.confirmTimeoutMs);

  try {
    const response = await fetch(`${config.payphone.apiBaseUrl}/api/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${config.payphone.token}`,
        'User-Agent':    'Comprobify/1.0',
      },
      body:   JSON.stringify({ id, clientTxId }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    let raw = '';
    try { raw = await response.text(); } catch (_) { /* ignore */ }

    // Payphone returns JSON on both success and error. A body we can't parse is
    // not a transport failure — record it and let the caller decide.
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (_) { /* ignore */ }

    return { ok: response.ok, statusCode: response.status, body, raw: raw.slice(0, 2000) };
  } catch (err) {
    clearTimeout(timer);
    // Transport-level only: timeout, DNS, connection reset. The charge's real
    // state is unknown — the caller must NOT mark the attempt terminal.
    return { ok: false, error: err.message?.slice(0, 200) || 'Unknown error' };
  }
}

function isConfigured() {
  return Boolean(config.payphone.token && config.payphone.storeId);
}

module.exports = { confirm, isConfigured };
