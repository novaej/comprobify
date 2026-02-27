const errorHandler = require('../../../src/middleware/error-handler');
const AppError = require('../../../src/errors/app-error');
const ValidationError = require('../../../src/errors/validation-error');
const SriError = require('../../../src/errors/sri-error');

describe('Error Handler Middleware', () => {
  let res;

  beforeEach(() => {
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('handles AppError with correct status code', () => {
    const err = new AppError('Something failed', 400);
    errorHandler(err, {}, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Something failed' });
  });

  test('handles ValidationError with errors array', () => {
    const fieldErrors = [{ field: 'name', message: 'required' }];
    const err = new ValidationError(fieldErrors);
    errorHandler(err, {}, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.ok).toBe(false);
    expect(body.errors).toEqual(fieldErrors);
  });

  test('handles SriError with sriMessages', () => {
    const messages = [{ identifier: '35', message: 'DOC INVALID' }];
    const err = new SriError('SRI rejected document', messages);
    errorHandler(err, {}, res, () => {});

    expect(res.status).toHaveBeenCalledWith(502);
    const body = res.json.mock.calls[0][0];
    expect(body.sriMessages).toEqual(messages);
  });

  test('handles unknown error with 500', () => {
    const err = new Error('unexpected');
    errorHandler(err, {}, res, () => {});

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Internal server error' });
    expect(console.error).toHaveBeenCalled();
  });
});
