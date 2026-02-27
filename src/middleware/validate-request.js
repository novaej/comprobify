const { validationResult } = require('express-validator');
const ValidationError = require('../errors/validation-error');

const validateRequest = (req, _res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formatted = errors.array().map((e) => ({
      field: e.path,
      message: e.msg,
      value: e.value,
    }));
    throw new ValidationError(formatted);
  }
  next();
};

module.exports = validateRequest;
