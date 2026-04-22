const config = require('../config');
const SriError = require('../errors/sri-error');

async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = 1000 * 2 ** (attempt - 1); // 1s → 2s → 4s
      console.warn(`SRI fetch attempt ${attempt} failed (${err.message}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

function buildReceptionEnvelope(xmlBase64) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.recepcion">
  <soapenv:Header/>
  <soapenv:Body>
    <ec:validarComprobante>
      <xml>${xmlBase64}</xml>
    </ec:validarComprobante>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function buildAuthorizationEnvelope(accessKey) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.autorizacion">
  <soapenv:Header/>
  <soapenv:Body>
    <ec:autorizacionComprobante>
      <claveAccesoComprobante>${accessKey}</claveAccesoComprobante>
    </ec:autorizacionComprobante>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function unescapeXml(str) {
  // &amp; must be last — it represents a literal & and must not re-decode other entities
  return str
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g,   (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g,  '&');
}

function extractTagContent(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractAllTags(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const results = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function parseMessages(xml) {
  const mensajesBlock = extractTagContent(xml, 'mensajes');
  if (!mensajesBlock) return [];

  const pick = (tag) =>
    [...mensajesBlock.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))]
      .map((m) => m[1].trim() || null);

  const identifiers     = pick('identificador');
  const msgs            = pick('mensaje');
  const additionalInfos = pick('informacionAdicional');
  const types           = pick('tipo');

  return identifiers.map((id, i) => ({
    identifier:     id,
    message:        msgs[i]             ?? null,
    additionalInfo: additionalInfos[i]  ?? null,
    type:           types[i]            ?? null,
  }));
}

/**
 * Derive which SRI endpoint set to use for a given issuer.
 *
 * Routing table:
 *   app env    | issuer.sandbox = true  | issuer.sandbox = false
 *   staging    | SRI test               | SRI test
 *   production | SRI test               | SRI production
 *
 * @param {{ sandbox: boolean }} issuer
 */
function getSriUrls(issuer) {
  const useTest = config.appEnv !== 'production' || issuer.sandbox;
  const base = useTest ? config.sri.testBaseUrl : config.sri.prodBaseUrl;
  return {
    receptionUrl: `${base}/RecepcionComprobantesOffline?wsdl`,
    authorizationUrl: `${base}/AutorizacionComprobantesOffline?wsdl`,
  };
}

async function sendReceipt(signedXml, issuer) {
  const { receptionUrl } = getSriUrls(issuer);
  const xmlBase64 = Buffer.from(signedXml, 'utf8').toString('base64');
  const envelope = buildReceptionEnvelope(xmlBase64);

  const response = await fetchWithRetry(receptionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '',
    },
    body: envelope,
  });

  const rawResponse = await response.text();

  if (!response.ok) {
    throw new SriError(`SRI reception service returned HTTP ${response.status}`, []);
  }

  const estado = extractTagContent(rawResponse, 'estado');
  const messages = parseMessages(rawResponse);

  return {
    status: estado,
    messages,
    rawResponse,
  };
}

async function checkAuthorization(accessKey, issuer) {
  const { authorizationUrl } = getSriUrls(issuer);
  const envelope = buildAuthorizationEnvelope(accessKey);

  const response = await fetchWithRetry(authorizationUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '',
    },
    body: envelope,
  });

  const rawResponse = await response.text();

  if (!response.ok) {
    throw new SriError(`SRI authorization service returned HTTP ${response.status}`, []);
  }

  const numeroComprobantes = extractTagContent(rawResponse, 'numeroComprobantes');
  const estado = extractTagContent(rawResponse, 'estado');
  const numeroAutorizacion = extractTagContent(rawResponse, 'numeroAutorizacion');
  const fechaAutorizacion = extractTagContent(rawResponse, 'fechaAutorizacion');
  const comprobante = extractTagContent(rawResponse, 'comprobante');
  const messages = parseMessages(rawResponse);

  return {
    pending: numeroComprobantes === '0',
    status: estado,
    authorizationNumber: numeroAutorizacion,
    authorizationDate: fechaAutorizacion,
    authorizationXml: comprobante ? unescapeXml(comprobante) : null,
    messages,
    rawResponse,
  };
}

module.exports = { sendReceipt, checkAuthorization };
