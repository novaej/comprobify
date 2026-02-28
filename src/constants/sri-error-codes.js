const SriErrorCodes = Object.freeze({
  // Document rejected — correct data and re-send with SAME access key + sequential
  RESUBMITTABLE: new Set([2, 10, 35, 36, 39, 40, 52, 56, 57, 58, 63]),

  // SRI already has this access key or it is in processing — do not resend
  // 43 = ya fue recibida, 70 = clave en procesamiento
  ALREADY_IN_SRI: new Set([43, 70]),

  // Duplicate sequential — document already processed, investigate manually
  DUPLICATE_SEQUENTIAL: new Set([45]),
});

module.exports = SriErrorCodes;
