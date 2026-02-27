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

function parseMessages(messagesXml) {
  const messages = [];
  const messageBlocks = extractAllTags(messagesXml, 'mensaje');
  for (const block of messageBlocks) {
    messages.push({
      identifier: extractTagContent(block, 'identificador'),
      message: extractTagContent(block, 'mensaje'),
      additionalInfo: extractTagContent(block, 'informacionAdicional'),
      type: extractTagContent(block, 'tipo'),
    });
  }
  return messages;
}

function getSriUrls(environment) {
  const base = environment === '2' ? config.sri.prodBaseUrl : config.sri.testBaseUrl;
  return {
    receptionUrl: `${base}/RecepcionComprobantesOffline?wsdl`,
    authorizationUrl: `${base}/AutorizacionComprobantesOffline?wsdl`,
  };
}

async function sendReceipt(signedXml, environment) {
  const { receptionUrl } = getSriUrls(environment);
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

async function checkAuthorization(accessKey, environment) {
  const { authorizationUrl } = getSriUrls(environment);
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

  const estado = extractTagContent(rawResponse, 'estado');
  const numeroAutorizacion = extractTagContent(rawResponse, 'numeroAutorizacion');
  const fechaAutorizacion = extractTagContent(rawResponse, 'fechaAutorizacion');
  const comprobante = extractTagContent(rawResponse, 'comprobante');
  const messages = parseMessages(rawResponse);

  return {
    status: estado,
    authorizationNumber: numeroAutorizacion,
    authorizationDate: fechaAutorizacion,
    authorizationXml: comprobante,
    messages,
    rawResponse,
  };
}

module.exports = { sendReceipt, checkAuthorization };
