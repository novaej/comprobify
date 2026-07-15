const DocumentStatus = require('../../../src/constants/document-status');
const { canTransition, assertTransition } = require('../../../src/constants/document-state-machine');

describe('document state machine', () => {
  test('SIGNED can only move to PENDING_SEND (no more direct SIGNED -> RECEIVED/RETURNED)', () => {
    expect(canTransition(DocumentStatus.SIGNED, DocumentStatus.PENDING_SEND)).toBe(true);
    expect(canTransition(DocumentStatus.SIGNED, DocumentStatus.RECEIVED)).toBe(false);
    expect(canTransition(DocumentStatus.SIGNED, DocumentStatus.RETURNED)).toBe(false);
  });

  test('PENDING_SEND can move to RECEIVED or RETURNED', () => {
    expect(canTransition(DocumentStatus.PENDING_SEND, DocumentStatus.RECEIVED)).toBe(true);
    expect(canTransition(DocumentStatus.PENDING_SEND, DocumentStatus.RETURNED)).toBe(true);
    expect(canTransition(DocumentStatus.PENDING_SEND, DocumentStatus.AUTHORIZED)).toBe(false);
  });

  test('assertTransition throws INVALID_STATE_TRANSITION for SIGNED -> RECEIVED', () => {
    expect(() => assertTransition(DocumentStatus.SIGNED, DocumentStatus.RECEIVED))
      .toThrow(expect.objectContaining({ statusCode: 400, code: 'INVALID_STATE_TRANSITION' }));
  });

  test('unaffected edges are unchanged: RECEIVED -> AUTHORIZED/NOT_AUTHORIZED, RETURNED/NOT_AUTHORIZED -> SIGNED', () => {
    expect(canTransition(DocumentStatus.RECEIVED, DocumentStatus.AUTHORIZED)).toBe(true);
    expect(canTransition(DocumentStatus.RECEIVED, DocumentStatus.NOT_AUTHORIZED)).toBe(true);
    expect(canTransition(DocumentStatus.RETURNED, DocumentStatus.SIGNED)).toBe(true);
    expect(canTransition(DocumentStatus.NOT_AUTHORIZED, DocumentStatus.SIGNED)).toBe(true);
    expect(canTransition(DocumentStatus.AUTHORIZED, DocumentStatus.RECEIVED)).toBe(false);
  });
});
