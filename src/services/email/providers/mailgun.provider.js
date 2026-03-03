const Mailgun = require('mailgun.js');
const FormData = require('form-data');
const config = require('../../../config');

function getClient() {
  const mg = new Mailgun(FormData);
  return mg.client({ username: 'api', key: config.email.mailgunApiKey });
}

/**
 * @param {{ to: string, subject: string, text: string, html: string, attachments: Array<{ filename: string, data: Buffer, contentType: string }> }} options
 */
async function send({ to, subject, text, html, attachments }) {
  const client = getClient();

  const messageData = {
    from: config.email.from,
    to,
    subject,
    text,
    html,
    attachment: attachments.map(({ filename, data, contentType }) => ({
      filename,
      data,
      contentType,
    })),
  };

  const response = await client.messages.create(config.email.mailgunDomain, messageData);
  return { messageId: response.id };
}

module.exports = { send };
