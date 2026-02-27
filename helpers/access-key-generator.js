/**
 * Generates a 49-digit SRI access key.
 *
 * Field breakdown:
 *   Issue date        — DDMMYYYY   — 8 digits
 *   Document type     — Table 3    — 2 digits
 *   RUC               — 13 digits
 *   Environment       — Table 4    — 1 digit
 *   Series            — estab+pto  — 6 digits
 *   Sequential number — 000000001  — 9 digits
 *   Numeric code      — emitter    — 8 digits
 *   Emission type     — Table 2    — 1 digit
 *   Check digit       — Module 11  — 1 digit
 */
const generateAccessKey = (issueDate, ruc, documentType, environment, emissionType, invoiceNumber, numericCode) => {
    const hasRuc = ruc.length > 0;
    const hasDocumentType = documentType !== '00';
    const hasEmissionType = emissionType !== '0';

    const formattedDate = issueDate.format('DDMMyyyy');

    return new Promise((resolve, reject) => {
        if (!hasRuc || !hasDocumentType || !hasEmissionType) {
            reject('Failed to generate access key');
        } else {
            let accessKey = `${formattedDate}${documentType}${ruc}${environment}${invoiceNumber}${numericCode}${emissionType}`;
            const checkDigit = generateModule11Digit(accessKey);
            accessKey = `${formattedDate}${documentType}${ruc}${environment}${invoiceNumber}${numericCode}${emissionType}${checkDigit}`;
            resolve(accessKey);
        }
    });
}

const generateModule11Digit = (accessKey = '', factor = 2) => {
    const digits = accessKey.split('');
    let currentFactor = factor;
    let sum = 0;

    for (let i = digits.length - 1; i >= 0; i--) {
        if (currentFactor <= 7) {
            sum += digits[i] * currentFactor;
            currentFactor++;
        } else {
            currentFactor = factor;
        }
    }

    const mod11 = sum % 11;
    const remainder = 11 - mod11;

    return remainder === 11 ? 0 : remainder === 10 ? 1 : remainder;
}

module.exports = { generateAccessKey };
