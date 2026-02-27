const { validationResult } = require('express-validator');
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
    issueDate: '26/02/2026',
    buyer: { idType: '04', id: '1712345678001', name: 'BUYER S.A.', address: 'ADDRESS' },
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
});
