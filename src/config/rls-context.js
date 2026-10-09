const { AsyncLocalStorage } = require('async_hooks');

// Who the current request or job is acting for. Read by src/config/database.js
// to set the Row-Level Security context on every query — see ADR-037.
const storage = new AsyncLocalStorage();

const current = () => storage.getStore() || null;

// Cross-tenant work: admin routes, cron jobs, pre-authentication lookups.
const runAsSystem = (fn) => storage.run({ system: true }, fn);

// Everything a tenant's own API key (or its queued effect) does.
const runAsTenant = (tenantId, fn) => storage.run({ tenantId: String(tenantId) }, fn);

module.exports = { current, runAsSystem, runAsTenant };
