const errorHandler = require('../../../src/middleware/error-handler');
const AppError = require('../../../src/errors/app-error');
const ValidationError = require('../../../src/errors/validation-error');
const SriError = require('../../../src/errors/sri-error');

describe('Error Handler Middleware', () => {
  let req;
  let res;

  beforeEach(() => {
    req = { originalUrl: '/api/documents/123/send' };
    res = {
      set: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('handles AppError with correct RFC 7807 shape', () => {
    const err = new AppError('Something failed', 400);
    errorHandler(err, req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.set).toHaveBeenCalledWith('Content-Type', 'application/problem+json');
    expect(res.json).toHaveBeenCalledWith({
      type: '/problems/bad-request',
      title: 'Bad Request',
      status: 400,
      code: 'BAD_REQUEST',
      detail: 'Something failed',
      instance: '/api/documents/123/send',
    });
  });

  test('handles ValidationError with errors array and field codes', () => {
    const fieldErrors = [{ field: 'name', message: 'required', code: 'name' }];
    const err = new ValidationError(fieldErrors);
    errorHandler(err, req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('/problems/validation-error');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors).toEqual(fieldErrors);
    expect(body.detail).toBe('Validation failed');
    expect(body.instance).toBe('/api/documents/123/send');
  });

  test('handles SriError with sriMessages and specific code', () => {
    const messages = [{ identifier: '35', message: 'DOC INVALID' }];
    const err = new SriError('SRI rejected document', messages);
    errorHandler(err, req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(502);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('/problems/sri-error');
    expect(body.code).toBe('SRI_SUBMISSION_FAILED');
    expect(body.sriMessages).toEqual(messages);
    expect(body.instance).toBe('/api/documents/123/send');
  });

  test('handles unknown error with 500 RFC 7807 shape', () => {
    const err = new Error('unexpected');
    errorHandler(err, req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.set).toHaveBeenCalledWith('Content-Type', 'application/problem+json');
    expect(res.json).toHaveBeenCalledWith({
      type: '/problems/internal-error',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
      instance: '/api/documents/123/send',
    });
    expect(console.error).toHaveBeenCalled();
  });
});
