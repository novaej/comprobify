const moment = require('moment');
const { getTranslations } = require('../../../locales');

/**
 * @param {object} document  - DB row from documents table
 * @param {object} issuer    - DB row from issuers table
 * @param {string} language  - locale code (defaults to 'es')
 * @returns {{ subject: string, text: string, html: string }}
 */
function render(document, issuer, language = 'es') {
  const t = getTranslations(language).email.invoiceAuthorized;

  const sequential = String(document.sequential).padStart(9, '0');
  const formattedSeq = `${document.branch_code}-${document.issue_point_code}-${sequential}`;
  const issueDate = moment(document.issue_date).format('DD/MM/YYYY');
  const total = parseFloat(document.total).toFixed(2);
  const authNumber = document.authorization_number || '';
  const buyerName = document.buyer_name || 'Cliente';
  const issuerName = issuer.business_name;
  const issuerRuc = issuer.ruc;
  const accessKey = document.access_key;
  const docTypeLabel = t.documentTypeLabels[document.document_type] || t.documentTypeLabels['01'];

  const subject = t.subject(docTypeLabel, formattedSeq, issuerName);
  const labelInvoiceNumber = t.labelInvoiceNumber(docTypeLabel);

  const text = [
    t.greeting(buyerName),
    '',
    t.intro,
    '',
    `  ${labelInvoiceNumber}:  ${formattedSeq}`,
    `  ${t.labelIssueDate}:  ${issueDate}`,
    `  ${t.labelTotal}:  $${total}`,
    `  ${t.labelAuthorizationNumber}:  ${authNumber}`,
    '',
    t.attachmentsIntro,
    `  • RIDE-${accessKey}.pdf  — ${t.attachmentRide}`,
    `  • ${accessKey}.xml       — ${t.attachmentXml}`,
    '',
    t.thanks,
    '',
    issuerName,
    t.ruc(issuerRuc),
    '',
    t.disclaimer,
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="${language}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p>${escapeHtml(t.greeting(buyerName))}</p>
  <p>${escapeHtml(t.intro)}</p>
  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(labelInvoiceNumber)}</td><td style="padding: 6px 12px;">${escapeHtml(formattedSeq)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelIssueDate)}</td><td style="padding: 6px 12px;">${escapeHtml(issueDate)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelTotal)}</td><td style="padding: 6px 12px;">$${escapeHtml(total)}</td></tr>
    <tr><td style="padding: 6px 12px; background: #f5f5f5; font-weight: bold;">${escapeHtml(t.labelAuthorizationNumber)}</td><td style="padding: 6px 12px;">${escapeHtml(authNumber)}</td></tr>
  </table>
  <p>${escapeHtml(t.attachmentsIntro)}</p>
  <ul>
    <li><strong>RIDE-${escapeHtml(accessKey)}.pdf</strong> — ${escapeHtml(t.attachmentRide)}</li>
    <li><strong>${escapeHtml(accessKey)}.xml</strong> — ${escapeHtml(t.attachmentXml)}</li>
  </ul>
  <p>${escapeHtml(t.thanks)}</p>
  <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
  <p style="font-size: 12px; color: #666;">
    <strong>${escapeHtml(issuerName)}</strong><br>
    ${escapeHtml(t.ruc(issuerRuc))}
  </p>
  <p style="font-size: 11px; color: #999;">${escapeHtml(t.disclaimer)}</p>
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
