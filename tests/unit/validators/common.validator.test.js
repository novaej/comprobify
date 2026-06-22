const { validationResult } = require('express-validator');

const { listDocumentsQuery } = require('../../../src/validators/common.validator');

async function runValidation(query) {
  const req = { body: {}, params: {}, query };
  const res = {};
  for (const middleware of listDocumentsQuery) {
    await new Promise((resolve) => middleware(req, res, resolve));
  }
  return validationResult(req);
}

describe('listDocumentsQuery validator', () => {
  test('accepts an empty query (all fields optional)', async () => {
    const result = await runValidation({});
    expect(result.isEmpty()).toBe(true);
  });

  test('accepts a valid sortBy/sortDir pair', async () => {
    const result = await runValidation({ sortBy: 'buyerName', sortDir: 'asc' });
    expect(result.isEmpty()).toBe(true);
  });

  test('accepts sortBy without sortDir', async () => {
    const result = await runValidation({ sortBy: 'sequential' });
    expect(result.isEmpty()).toBe(true);
  });

  test('rejects an unsupported sortBy value', async () => {
    const result = await runValidation({ sortBy: 'total' });
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'sortBy')).toBe(true);
  });

  test('rejects an unsupported sortDir value', async () => {
    const result = await runValidation({ sortBy: 'status', sortDir: 'sideways' });
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'sortDir')).toBe(true);
  });

  test('accepts a sequential filter', async () => {
    const result = await runValidation({ sequential: '000123' });
    expect(result.isEmpty()).toBe(true);
  });

  test('rejects an empty sequential filter', async () => {
    const result = await runValidation({ sequential: '' });
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'sequential')).toBe(true);
  });

  test('accepts a buyerName filter', async () => {
    const result = await runValidation({ buyerName: 'Acme Corp' });
    expect(result.isEmpty()).toBe(true);
  });

  test('rejects an empty buyerName filter', async () => {
    const result = await runValidation({ buyerName: '' });
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'buyerName')).toBe(true);
  });

  test.each(['01', '03', '04', '05', '06', '07'])('accepts documentType %s', async (documentType) => {
    const result = await runValidation({ documentType });
    expect(result.isEmpty()).toBe(true);
  });

  test('rejects an unsupported documentType', async () => {
    const result = await runValidation({ documentType: '99' });
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'documentType')).toBe(true);
  });
});
