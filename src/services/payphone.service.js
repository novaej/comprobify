const config = require('../config');

// Payphone vendor client, confirmation only. This call captures the money —
// Payphone auto-reverses anything unconfirmed after 5 minutes.

// Payphone echoes back the payer's email, phone and cédula. We need none of it:
// everything we use is money, status or card metadata. Allow-list rather than
// block-list, so a new PII field on their side is dropped by default.
const PERSISTED_FIELDS = [
  'transactionId', 'clientTransactionId', 'statusCode', 'transactionStatus',
  'authorizationCode', 'message', 'messages', 'errorCode', 'errors',
  'amount', 'amountWithTax', 'amountWithoutTax', 'tax', 'service', 'tip', 'currency',
  'cardBrand', 'cardType', 'lastDigits',
  'storeName', 'reference', 'date', 'transactionDate',
  'deferredCode', 'deferredMessage', 'deferredType', 'regionalReference',
];

function sanitizeConfirmResponse(body) {
  if (!body || typeof body !== 'object') return body ?? null;
  const out = {};
  for (const key of PERSISTED_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

// Never throws: the caller must tell an unresolved charge (transport failure)
// apart from a declined one, and an exception would collapse the two.
// @returns {{ ok, statusCode?, body?, raw? } | { ok: false, error }}
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

    // raw stays unfiltered for the unparseable-body case, but is diagnostic only —
    // nothing consumes it and it must never be persisted or logged.
    return {
      ok: response.ok,
      statusCode: response.status,
      body: sanitizeConfirmResponse(body),
      raw: raw.slice(0, 2000),
    };
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

module.exports = { confirm, isConfigured, sanitizeConfirmResponse };
