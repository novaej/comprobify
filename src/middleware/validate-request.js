const { validationResult } = require('express-validator');
const ValidationError = require('../errors/validation-error');

// Strip array indices to produce a stable i18n key: items[0].taxes[1].code → items.taxes.code
function fieldToCode(path) {
  return path.replace(/\[\d+\]/g, '') || 'general';
}

const validateRequest = (req, _res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formatted = errors.array().map((e) => ({
      field: e.path,
      message: e.msg,
      code: fieldToCode(e.path),
      value: e.value,
    }));
    throw new ValidationError(formatted);
  }
  next();
};

module.exports = validateRequest;
