const mailgunWebhookService = require('../services/mailgun-webhook.service');

async function handle(req, res) {
  await mailgunWebhookService.processEvent(req.body);
  res.sendStatus(200);
}

module.exports = { handle };
