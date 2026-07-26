// notification_email_templates CRUD — mirrors agreement.model.js's shape,
// keyed additionally by `language` (agreements only ever ship in Spanish).
const db = require('../config/database');
const { getClient } = db;

async function create({ notificationType, language, version, subjectTemplate, htmlTemplate, textTemplate }) {
  const { rows } = await db.query(
    `INSERT INTO notification_email_templates (notification_type, language, version, subject_template, html_template, text_template)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [notificationType, language, version, subjectTemplate, htmlTemplate, textTemplate]
  );
  return rows[0];
}

// Activates a specific row as the current version for its (notification_type,
// language) pair. Runs in a transaction: clears is_current on siblings, then
// sets it on the target — mirrors agreement.model.js's activate().
async function activate(id) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: [target] } = await client.query(
      'SELECT * FROM notification_email_templates WHERE id = $1', [id]
    );
    if (!target) { await client.query('ROLLBACK'); return null; }
    await client.query(
      `UPDATE notification_email_templates SET is_current = false
       WHERE notification_type = $1 AND language = $2 AND is_current = true`,
      [target.notification_type, target.language]
    );
    const { rows: [updated] } = await client.query(
      `UPDATE notification_email_templates SET is_current = true WHERE id = $1 RETURNING *`,
      [id]
    );
    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function findCurrent(notificationType, language) {
  const { rows } = await db.query(
    `SELECT * FROM notification_email_templates WHERE notification_type = $1 AND language = $2 AND is_current = true`,
    [notificationType, language]
  );
  return rows[0] || null;
}

async function findAllCurrent() {
  const { rows } = await db.query(
    `SELECT id, notification_type, language, version, created_at
     FROM notification_email_templates
     WHERE is_current = true
     ORDER BY notification_type, language`
  );
  return rows;
}

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM notification_email_templates WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findAllByTypeAndLanguage(notificationType, language) {
  const { rows } = await db.query(
    `SELECT id, notification_type, language, version, is_current, created_at
     FROM notification_email_templates
     WHERE notification_type = $1 AND language = $2
     ORDER BY created_at DESC`,
    [notificationType, language]
  );
  return rows;
}

module.exports = { create, activate, findCurrent, findAllCurrent, findById, findAllByTypeAndLanguage };
