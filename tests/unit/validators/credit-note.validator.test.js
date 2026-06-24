const { validationResult } = require('express-validator');
const moment = require('moment');

jest.mock('../../../src/models/catalog.model', () => ({
  isValidIdType:       jest.fn(async (v) => ['04', '05', '06', '07', '08'].includes(v)),
  isValidTaxType:      jest.fn(async (v) => ['2', '3', '5'].includes(v)),
  isValidTaxRate:      jest.fn(async (taxCode, rateCode) => {
    const valid = { '2': ['0', '2', '3', '6', '7'], '3': ['3051'], '5': ['5001'] };
    return valid[taxCode]?.includes(rateCode) ?? false;
  }),
  isValidDocumentType: jest.fn(async (v) => ['01', '03', '04', '05', '06', '07'].includes(v)),
}));

const { createCreditNote } = require('../../../src/validators/credit-note.validator');

async function runValidation(body) {
  const req = { body, params: {}, query: {} };
  const res = {};
  for (const middleware of createCreditNote) {
    await new Promise((resolve) => middleware(req, res, resolve));
  }
  return validationResult(req);
}

describe('Credit Note Validator', () => {
  const validBody = {
    documentType: '04',
    issueDate: moment().format('DD/MM/YYYY'),
    buyer: { idType: '04', id: '1712345678001', name: 'BUYER S.A.', address: 'ADDRESS', email: 'buyer@example.com' },
    originalDocument: { documentType: '01', number: '001-001-000000027', issueDate: '03/04/2026' },
    motivo: 'Devolución de mercadería',
    items: [{
      mainCode: '001',
      description: 'SERVICE',
      quantity: '1.000000',
      unitPrice: '100.000000',
      discount: '0.00',
      taxes: [{ code: '2', rateCode: '2', rate: '15.00' }],
    }],
  };

  test('accepts valid credit note body', async () => {
    const result = await runValidation(validBody);
    expect(result.isEmpty()).toBe(true);
  });

  test('does not require a payments array', async () => {
    const result = await runValidation(validBody);
    expect(result.isEmpty()).toBe(true);
    expect(result.array().some((e) => e.path === 'payments')).toBe(false);
  });

  test('rejects missing documentType', async () => {
    const { documentType, ...body } = validBody;
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'documentType')).toBe(true);
  });

  test('rejects unsupported documentType', async () => {
    const result = await runValidation({ ...validBody, documentType: '01' });
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'documentType')).toBe(true);
  });

  test('rejects missing originalDocument', async () => {
    const { originalDocument, ...body } = validBody;
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'originalDocument')).toBe(true);
  });

  test('rejects malformed originalDocument.number', async () => {
    const body = { ...validBody, originalDocument: { ...validBody.originalDocument, number: '1-1-1' } };
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'originalDocument.number')).toBe(true);
  });

  test('rejects invalid originalDocument.documentType', async () => {
    const body = { ...validBody, originalDocument: { ...validBody.originalDocument, documentType: '99' } };
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'originalDocument.documentType')).toBe(true);
  });

  test('rejects malformed originalDocument.issueDate', async () => {
    const body = { ...validBody, originalDocument: { ...validBody.originalDocument, issueDate: '2026-04-03' } };
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'originalDocument.issueDate')).toBe(true);
  });

  test('rejects missing motivo', async () => {
    const { motivo, ...body } = validBody;
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'motivo')).toBe(true);
  });

  test('rejects motivo longer than 300 characters', async () => {
    const result = await runValidation({ ...validBody, motivo: 'a'.repeat(301) });
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'motivo')).toBe(true);
  });

  test('rejects missing buyer email', async () => {
    const { email, ...buyerNoEmail } = validBody.buyer;
    const result = await runValidation({ ...validBody, buyer: buyerNoEmail });
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'buyer.email')).toBe(true);
  });

  test('rejects empty items array', async () => {
    const result = await runValidation({ ...validBody, items: [] });
    expect(result.isEmpty()).toBe(false);
  });

  test('rejects unknown tax code', async () => {
    const items = [{ ...validBody.items[0], taxes: [{ ...validBody.items[0].taxes[0], code: '9' }] }];
    const result = await runValidation({ ...validBody, items });
    expect(result.isEmpty()).toBe(false);
  });
});
