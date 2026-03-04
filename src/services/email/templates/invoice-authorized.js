const moment = require('moment');

/**
 * @param {object} document  - DB row from documents table
 * @param {object} issuer    - DB row from issuers table
 * @returns {{ subject: string, text: string, html: string }}
 */
function render(document, issuer) {
  const sequential = String(document.sequential).padStart(9, '0');
  const formattedSeq = `${document.branch_code}-${document.issue_point_code}-${sequential}`;
  const issueDate = moment(document.issue_date).format('DD/MM/YYYY');
  const total = parseFloat(document.total).toFixed(2);
  const authNumber = document.authorization_number || '';
  const buyerName = document.buyer_name || 'Cliente';
  const issuerName = issuer.business_name;
  const issuerRuc = issuer.ruc;
  const accessKey = document.access_key;

  const subject = `Factura Electrónica N° ${formattedSeq} — ${issuerName}`;

  const text = [
    `Estimado/a ${buyerName},`,
    '',
    'Nos complacemos en informarle que su comprobante electrónico ha sido',
    'autorizado por el SRI.',
    '',
    `  Factura N°:              ${formattedSeq}`,
    `  Fecha de emisión:        ${issueDate}`,
    `  Total:                   $${total}`,
    `  Número de autorización:  ${authNumber}`,
    '',
    'Adjunto encontrará los siguientes documentos:',
    `  • RIDE-${accessKey}.pdf  — Representación impresa del comprobante`,
    `  • ${accessKey}.xml       — Comprobante electrónico (XML autorizado)`,
    '',
    'Gracias por su preferencia.',
    '',
    issuerName,
    `RUC: ${issuerRuc}`,
    '',
    'No responder — este es un mensaje automático.',
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p>Estimado/a <strong>${escapeHtml(buyerName)}</strong>,</p>
  <p>Nos complacemos en informarle que su comprobante electrónico ha sido autorizado por el SRI.</p>
  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Factura N°</td><td style="padding: 6px 12px;">${escapeHtml(formattedSeq)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Fecha de emisión</td><td style="padding: 6px 12px;">${escapeHtml(issueDate)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Total</td><td style="padding: 6px 12px;">$${escapeHtml(total)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">Número de autorización</td><td style="padding: 6px 12px;">${escapeHtml(authNumber)}</td></tr>
  </table>
  <p>Adjunto encontrará los siguientes documentos:</p>
  <ul>
    <li><strong>RIDE-${escapeHtml(accessKey)}.pdf</strong> — Representación impresa del comprobante</li>
    <li><strong>${escapeHtml(accessKey)}.xml</strong> — Comprobante electrónico (XML autorizado)</li>
  </ul>
  <p>Gracias por su preferencia.</p>
  <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
  <p style="font-size: 12px; color: #666;">
    <strong>${escapeHtml(issuerName)}</strong><br>
    RUC: ${escapeHtml(issuerRuc)}
  </p>
  <p style="font-size: 11px; color: #999;">No responder — este es un mensaje automático.</p>
</body>
</html>`.trim();

  return { subject, text, html };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { render };
