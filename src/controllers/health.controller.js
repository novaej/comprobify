const asyncHandler = require('../middleware/async-handler');
const healthService = require('../services/health.service');
const { version } = require('../../package.json');

const check = asyncHandler(async (_req, res) => {
  const { healthy } = await healthService.checkHealth();
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'error',
    uptime: process.uptime(),
    version,
  });
});

module.exports = { check };
