const { validationResult } = require('express-validator');

jest.mock('../../../src/models/catalog.model', () => ({
  isValidIdType:       jest.fn(async (v) => ['04', '05', '06', '07', '08'].includes(v)),
  isValidTaxType:      jest.fn(async (v) => ['2', '3', '5'].includes(v)),
  isValidTaxRate:      jest.fn(async (taxCode, rateCode) => {
    const valid = { '2': ['0', '2', '3', '6', '7'], '3': ['3051'], '5': ['5001'] };
    return valid[taxCode]?.includes(rateCode) ?? false;
  }),
  isValidPaymentMethod: jest.fn(async (v) => ['01','15','16','17','18','19','20','21'].includes(v)),
}));

const { createInvoice } = require('../../../src/validators/invoice.validator');

async function runValidation(body) {
  const req = { body, params: {}, query: {} };
  const res = {};
  for (const middleware of createInvoice) {
    await new Promise((resolve) => middleware(req, res, resolve));
  }
  return validationResult(req);
}

describe('Invoice Validator', () => {
  const validBody = {
    documentType: '01',
    issueDate: '26/02/2026',
    buyer: { idType: '04', id: '1712345678001', name: 'BUYER S.A.', address: 'ADDRESS', email: 'buyer@example.com' },
    items: [{
      mainCode: '001',
      description: 'SERVICE',
      quantity: '1.000000',
      unitPrice: '100.000000',
      discount: '0.00',
      taxes: [{ code: '2', rateCode: '2', rate: '12.00', taxBase: '100.00', value: '12.00' }],
    }],
    payments: [{ method: '20', total: '112.00' }],
  };

  test('accepts valid invoice body', async () => {
    const result = await runValidation(validBody);
    expect(result.isEmpty()).toBe(true);
  });

  test('accepts when issueDate is omitted (optional)', async () => {
    const { issueDate, ...body } = validBody;
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(true);
  });

  test('rejects missing documentType', async () => {
    const { documentType, ...body } = validBody;
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some(e => e.path === 'documentType')).toBe(true);
  });

  test('rejects unsupported documentType', async () => {
    const result = await runValidation({ ...validBody, documentType: '04' });
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some(e => e.path === 'documentType')).toBe(true);
  });

  test('rejects invalid date format', async () => {
    const result = await runValidation({ ...validBody, issueDate: '2026-02-26' });
    expect(result.isEmpty()).toBe(false);
    const errors = result.array();
    expect(errors.some(e => e.path === 'issueDate')).toBe(true);
  });

  test('rejects missing buyer', async () => {
    const { buyer, ...body } = validBody;
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(false);
  });

  test('rejects missing buyer idType', async () => {
    const body = { ...validBody, buyer: { ...validBody.buyer, idType: '' } };
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(false);
  });

  test('rejects invalid buyer idType (wrong length)', async () => {
    const body = { ...validBody, buyer: { ...validBody.buyer, idType: '4' } };
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(false);
  });

  test('rejects empty items array', async () => {
    const result = await runValidation({ ...validBody, items: [] });
    expect(result.isEmpty()).toBe(false);
  });

  test('rejects missing item description', async () => {
    const items = [{ ...validBody.items[0], description: '' }];
    const result = await runValidation({ ...validBody, items });
    expect(result.isEmpty()).toBe(false);
  });

  test('rejects non-numeric quantity', async () => {
    const items = [{ ...validBody.items[0], quantity: 'abc' }];
    const result = await runValidation({ ...validBody, items });
    expect(result.isEmpty()).toBe(false);
  });

  test('rejects empty payments array', async () => {
    const result = await runValidation({ ...validBody, payments: [] });
    expect(result.isEmpty()).toBe(false);
  });

  test('rejects invalid payment method (wrong length)', async () => {
    const payments = [{ method: '1', total: '100.00' }];
    const result = await runValidation({ ...validBody, payments });
    expect(result.isEmpty()).toBe(false);
  });

  test('rejects missing tax fields', async () => {
    const items = [{
      ...validBody.items[0],
      taxes: [{ code: '', rateCode: '2', rate: '12', taxBase: '100', value: '12' }],
    }];
    const result = await runValidation({ ...validBody, items });
    expect(result.isEmpty()).toBe(false);
  });

  test('rejects unknown buyer idType', async () => {
    const body = { ...validBody, buyer: { ...validBody.buyer, idType: '99' } };
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some(e => e.path === 'buyer.idType')).toBe(true);
  });

  test('rejects unknown tax code', async () => {
    const items = [{ ...validBody.items[0], taxes: [{ ...validBody.items[0].taxes[0], code: '9' }] }];
    const result = await runValidation({ ...validBody, items });
    expect(result.isEmpty()).toBe(false);
  });

  test('rejects invalid rateCode for tax code', async () => {
    const items = [{ ...validBody.items[0], taxes: [{ ...validBody.items[0].taxes[0], rateCode: '99' }] }];
    const result = await runValidation({ ...validBody, items });
    expect(result.isEmpty()).toBe(false);
  });

  test('rejects missing buyer email', async () => {
    const { email, ...buyerNoEmail } = validBody.buyer;
    const body = { ...validBody, buyer: buyerNoEmail };
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some(e => e.path === 'buyer.email')).toBe(true);
  });

  test('rejects invalid buyer email', async () => {
    const body = { ...validBody, buyer: { ...validBody.buyer, email: 'not-an-email' } };
    const result = await runValidation(body);
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some(e => e.path === 'buyer.email')).toBe(true);
  });

  test('rejects unknown payment method', async () => {
    const payments = [{ method: '99', total: '100.00' }];
    const result = await runValidation({ ...validBody, payments });
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some(e => e.path === 'payments[0].method')).toBe(true);
  });
});
