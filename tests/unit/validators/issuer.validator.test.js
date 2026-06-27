const { validationResult } = require('express-validator');

const { createBranch } = require('../../../src/validators/issuer.validator');

async function runValidation(body) {
  const req = { body, params: {}, query: {} };
  const res = {};
  for (const middleware of createBranch) {
    await new Promise((resolve) => middleware(req, res, resolve));
  }
  return { req, result: validationResult(req) };
}

describe('Issuer Validator — createBranch', () => {
  const validBody = {
    branchCode: '001',
    issuePointCode: '001',
  };

  test('accepts documentTypes/initialSequentials sent as a JSON-encoded string (multipart/form-data)', async () => {
    const { req, result } = await runValidation({
      ...validBody,
      documentTypes: JSON.stringify(['01', '04']),
      initialSequentials: JSON.stringify([{ documentType: '01', sequential: 50 }]),
    });

    expect(result.isEmpty()).toBe(true);
    expect(req.body.documentTypes).toEqual(['01', '04']);
    expect(req.body.initialSequentials).toEqual([{ documentType: '01', sequential: 50 }]);
  });

  test('still accepts documentTypes/initialSequentials sent as a native array (application/json)', async () => {
    const { req, result } = await runValidation({
      ...validBody,
      documentTypes: ['01'],
      initialSequentials: [{ documentType: '01', sequential: 1 }],
    });

    expect(result.isEmpty()).toBe(true);
    expect(req.body.documentTypes).toEqual(['01']);
  });

  test('rejects a documentTypes string that is not valid JSON', async () => {
    const { result } = await runValidation({
      ...validBody,
      documentTypes: 'not-json',
    });

    expect(result.isEmpty()).toBe(false);
  });

  test('rejects an unsupported document type inside the JSON-encoded array', async () => {
    const { result } = await runValidation({
      ...validBody,
      documentTypes: JSON.stringify(['99']),
    });

    expect(result.isEmpty()).toBe(false);
  });
});
