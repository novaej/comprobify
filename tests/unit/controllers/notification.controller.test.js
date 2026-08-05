const { parseOptionalIssuerId, parseSinceId } = require('../../../src/controllers/notification.controller');

const VALID_UUID = '019fb533-f97f-728f-96b6-28a44232f7ba';

function makeReq({ issuerIdHeader, sinceId } = {}) {
  return {
    headers: issuerIdHeader !== undefined ? { 'x-issuer-id': issuerIdHeader } : {},
    query: sinceId !== undefined ? { sinceId } : {},
  };
}

describe('notification.controller', () => {
  describe('parseOptionalIssuerId', () => {
    test('returns null when the X-Issuer-Id header is absent', () => {
      expect(parseOptionalIssuerId(makeReq())).toBeNull();
    });

    test('returns the UUID unchanged when the header is a valid UUID', () => {
      expect(parseOptionalIssuerId(makeReq({ issuerIdHeader: VALID_UUID }))).toBe(VALID_UUID);
    });

    test('trims surrounding whitespace on a valid UUID', () => {
      expect(parseOptionalIssuerId(makeReq({ issuerIdHeader: `  ${VALID_UUID}  ` }))).toBe(VALID_UUID);
    });

    // Regression test: parseOptionalIssuerId used to parseInt() the header,
    // which silently truncated a real UUID to its leading decimal digits and
    // then always failed a string-equality check — so a perfectly valid UUID
    // always 400'd. See CLAUDE.md's Common Mistakes list.
    test('accepts a real UUID that would have been truncated by parseInt (regression)', () => {
      expect(() => parseOptionalIssuerId(makeReq({ issuerIdHeader: VALID_UUID }))).not.toThrow();
    });

    test('throws 400 ISSUER_ID_INVALID when the header is not a valid UUID', () => {
      expect(() => parseOptionalIssuerId(makeReq({ issuerIdHeader: 'not-a-uuid' })))
        .toThrow(expect.objectContaining({ statusCode: 400, code: 'ISSUER_ID_INVALID' }));
    });

    test('throws when the header is a plain integer, not a UUID', () => {
      expect(() => parseOptionalIssuerId(makeReq({ issuerIdHeader: '123' })))
        .toThrow(expect.objectContaining({ statusCode: 400, code: 'ISSUER_ID_INVALID' }));
    });
  });

  describe('parseSinceId', () => {
    test('returns null when ?sinceId is absent', () => {
      expect(parseSinceId(makeReq())).toBeNull();
    });

    test('returns null when ?sinceId is an empty string', () => {
      expect(parseSinceId(makeReq({ sinceId: '' }))).toBeNull();
    });

    test('returns the UUID unchanged when ?sinceId is a valid UUID', () => {
      expect(parseSinceId(makeReq({ sinceId: VALID_UUID }))).toBe(VALID_UUID);
    });

    // Same regression as parseOptionalIssuerId — cursor-based polling with a
    // real notification id used to always 400.
    test('accepts a real UUID that would have been truncated by parseInt (regression)', () => {
      expect(() => parseSinceId(makeReq({ sinceId: VALID_UUID }))).not.toThrow();
    });

    test('throws 400 ISSUER_ID_INVALID when ?sinceId is not a valid UUID', () => {
      expect(() => parseSinceId(makeReq({ sinceId: 'not-a-uuid' })))
        .toThrow(expect.objectContaining({ statusCode: 400, code: 'ISSUER_ID_INVALID' }));
    });
  });
});
