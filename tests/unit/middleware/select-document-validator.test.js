const { validationResult } = require('express-validator');
const moment = require('moment');

jest.mock('../../../src/models/catalog.model', () => ({
  isValidIdType:       jest.fn(async (v) => ['04', '05', '06', '07', '08'].includes(v)),
  isValidTaxType:      jest.fn(async (v) => ['2', '3', '5'].includes(v)),
  isValidTaxRate:      jest.fn(async () => true),
  isValidPaymentMethod: jest.fn(async (v) => ['01', '20'].includes(v)),
  isValidTermUnit:      jest.fn(async (v) => ['dias', 'meses'].includes(v)),
  isValidDocumentType:  jest.fn(async (v) => ['01', '03', '04', '05', '06', '07'].includes(v)),
}));

const selectDocumentValidator = require('../../../src/middleware/select-document-validator');

async function dispatch(body) {
  const req = { body, params: {}, query: {} };
  await new Promise((resolve) => selectDocumentValidator(req, {}, resolve));
  return validationResult(req);
}

const validInvoiceBody = {
  documentType: '01',
  issueDate: moment().format('DD/MM/YYYY'),
  buyer: { idType: '04', id: '1712345678001', name: 'BUYER S.A.', address: 'ADDRESS', email: 'buyer@example.com' },
  items: [{
    mainCode: '001', description: 'SERVICE', quantity: '1.000000', unitPrice: '100.000000', discount: '0.00',
    taxes: [{ code: '2', rateCode: '2', rate: '12.00' }],
  }],
  payments: [{ method: '20', total: '112.00' }],
};

const validCreditNoteBody = {
  documentType: '04',
  issueDate: moment().format('DD/MM/YYYY'),
  buyer: { idType: '04', id: '1712345678001', name: 'BUYER S.A.', address: 'ADDRESS', email: 'buyer@example.com' },
  originalDocument: { documentType: '01', number: '001-001-000000027', issueDate: '03/04/2026' },
  motivo: 'Devolución de mercadería',
  items: [{
    mainCode: '001', description: 'SERVICE', quantity: '1.000000', unitPrice: '100.000000', discount: '0.00',
    taxes: [{ code: '2', rateCode: '2', rate: '15.00' }],
  }],
};

describe('selectDocumentValidator', () => {
  test('dispatches to the invoice validator for documentType 01', async () => {
    const result = await dispatch(validInvoiceBody);
    expect(result.isEmpty()).toBe(true);
  });

  test('dispatches to the credit note validator for documentType 04', async () => {
    const result = await dispatch(validCreditNoteBody);
    expect(result.isEmpty()).toBe(true);
  });

  test('invoice body without payments fails invoice validation (wrong chain doesn\'t mask it)', async () => {
    const { payments, ...body } = validInvoiceBody;
    const result = await dispatch(body);
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'payments')).toBe(true);
  });

  test('credit note body is never required to carry payments', async () => {
    const result = await dispatch(validCreditNoteBody);
    expect(result.array().some((e) => e.path === 'payments')).toBe(false);
  });

  test('rejects an unsupported documentType with a single clear error', async () => {
    const result = await dispatch({ documentType: '99' });
    expect(result.isEmpty()).toBe(false);
    const errors = result.array();
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('documentType');
  });

  test('rejects a missing documentType the same way as an unsupported one', async () => {
    const result = await dispatch({});
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => e.path === 'documentType')).toBe(true);
  });
});
