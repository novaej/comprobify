const systemContext = require('../../../src/middleware/system-context');
const rlsContext = require('../../../src/config/rls-context');

describe('systemContext middleware', () => {
  test('runs the rest of the request in system context and does not leak it', () => {
    let downstream;
    systemContext({}, {}, () => { downstream = rlsContext.current(); });
    expect(downstream).toEqual({ system: true });
    expect(rlsContext.current()).toBeNull();
  });
});
