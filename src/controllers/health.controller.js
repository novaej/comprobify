const asyncHandler = require('../middleware/async-handler');
const healthService = require('../services/health.service');

const check = asyncHandler(async (_req, res) => {
  const { healthy } = await healthService.checkHealth();
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'error',
    uptime: process.uptime(),
  });
});

module.exports = { check };
