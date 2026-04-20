const { query } = require('../config/database');

async function checkHealth() {
  try {
    await query('SELECT 1');
    return { healthy: true };
  } catch {
    return { healthy: false };
  }
}

module.exports = { checkHealth };
