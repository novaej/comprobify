const config = require('../config');

// Payphone vendor client, confirmation only. This call captures the money —
// Payphone auto-reverses anything unconfirmed after 5 minutes.

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
