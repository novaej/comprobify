/**
 * DB-backed, versioned email templates for notifications (Phase C of
 * NEXT_STEPS.md item 13 / ADR-024). Mirrors agreement.service.js's
 * publish/activateVersion/getCurrent/getById/listVersionsByType shape —
 * see that file for the precedent this follows.
 *
 * Content is authored in docs/email-templates/{TYPE}.{lang}.txt (three
 * sections: SUBJECT:, ---HTML---, ---TEXT---) and read at publish time,
 * mirroring how agreement.service.js reads docs/agreements/*.md — or an
 * admin can pass rawContent directly (same "DB-supplied content bypasses
 * the file read" escape hatch agreements' publish() has).
 *
 * render(type, language, notification) is the one thing agreements doesn't
 * need an equivalent of: it resolves the current template for
 * (type, language) — falling back to DEFAULT_LANGUAGE if the tenant's
 * language has no published template — builds a small values object from
 * notification.metadata (plus a couple of derived labels/formatted dates
 * that can't be a raw metadata field, e.g. a purpose CODE -> localized
 * LABEL lookup), and substitutes it into all three templates.
 */
const fs = require('fs');
const path = require('path');
const moment = require('moment');
const notificationEmailTemplateModel = require('../models/notification-email-template.model');
const NotFoundError = require('../errors/not-found-error');
const AppError = require('../errors/app-error');
const ErrorCodes = require('../constants/error-codes');
const { substitute, substituteHtml } = require('../utils/template-placeholders');
const { DEFAULT_LANGUAGE } = require('../locales');
const config = require('../config');

// The 5 NotificationTypes with supportsEmail: true in notification-catalog.js
// — the only types that ever get a row in notification_email_templates.
const EMAIL_TEMPLATE_TYPES = [
  'PAYMENT_VERIFIED',
  'PAYMENT_REJECTED',
  'SUBSCRIPTION_RENEWAL_DUE',
  'SUBSCRIPTION_EXPIRED',
  'PRICE_CHANGE_ANNOUNCED',
];

// Purpose/rejection-reason CODE -> localized LABEL. Short, stable
// enumerations — kept here rather than in src/locales/ since these 5 types
// no longer use the locale-based JS template system at all (Phase C removes
// it for them). Mirrors notification.service.js's own (English-only, in-app
// message) PAYMENT_PURPOSE_LABELS/REJECTION_REASON_LABELS, just per-language.
const PURPOSE_LABELS = {
  es: { INITIAL: 'suscripción', TIER_CHANGE: 'cambio de plan', RENEWAL: 'renovación' },
  en: { INITIAL: 'subscription', TIER_CHANGE: 'tier change', RENEWAL: 'renewal' },
};
const REJECTION_REASON_LABELS = {
  es: {
    AMOUNT_MISMATCH: 'El monto transferido no coincide con el solicitado.',
    TRANSFER_NOT_FOUND: 'No se encontró una transferencia coincidente en la cuenta.',
    WRONG_ACCOUNT: 'La transferencia fue enviada a la cuenta incorrecta.',
    ILLEGIBLE_PROOF: 'El comprobante subido es ilegible o está dañado.',
    DUPLICATE_SUBMISSION: 'Este comprobante ya fue enviado y revisado para otro pago.',
    OTHER: 'Contacta a soporte para más detalles.',
  },
  en: {
    AMOUNT_MISMATCH: 'The transferred amount does not match what was requested.',
    TRANSFER_NOT_FOUND: 'No matching transfer was found in the account.',
    WRONG_ACCOUNT: 'The transfer was sent to the wrong account.',
    ILLEGIBLE_PROOF: 'The uploaded proof is illegible or corrupted.',
    DUPLICATE_SUBMISSION: 'This proof was already submitted and reviewed for another payment.',
    OTHER: 'Contact support for details.',
  },
};

function templateFilePath(notificationType, language) {
  return path.join(process.cwd(), 'docs/email-templates', `${notificationType}.${language}.txt`);
}

// Parses the SUBJECT: / ---HTML--- / ---TEXT--- source format.
function parseTemplateFile(raw) {
  const subjectMatch = raw.match(/^SUBJECT:\s*(.*)\r?\n/);
  if (!subjectMatch) {
    throw new AppError('Template source is missing a SUBJECT: header', 500, ErrorCodes.NOTIFICATION_TEMPLATE_MALFORMED);
  }
  const rest = raw.slice(subjectMatch[0].length);
  const sectionsMatch = rest.match(/---HTML---\r?\n([\s\S]*?)---TEXT---\r?\n([\s\S]*)$/);
  if (!sectionsMatch) {
    throw new AppError('Template source is missing ---HTML--- / ---TEXT--- sections', 500, ErrorCodes.NOTIFICATION_TEMPLATE_MALFORMED);
  }
  return {
    subjectTemplate: subjectMatch[1].trim(),
    htmlTemplate: sectionsMatch[1].trim(),
    textTemplate: sectionsMatch[2].trim(),
  };
}

// Publishes a new version from the docs/email-templates/*.txt source (or
// rawContent, when an admin wants to publish an edit directly without
// touching the filesystem — same escape hatch agreement.service.js's
// publish() has, same reasoning: see CLAUDE.md Common Mistake #34).
// Auto-activates, same as agreements.
async function publish(notificationType, language, version, rawContent = null) {
  const raw = rawContent != null ? rawContent : fs.readFileSync(templateFilePath(notificationType, language), 'utf8');
  const { subjectTemplate, htmlTemplate, textTemplate } = parseTemplateFile(raw);
  const doc = await notificationEmailTemplateModel.create({ notificationType, language, version, subjectTemplate, htmlTemplate, textTemplate });
  await notificationEmailTemplateModel.activate(doc.id);
  return doc;
}

async function activateVersion(id) {
  const doc = await notificationEmailTemplateModel.activate(id);
  if (!doc) throw new NotFoundError('Notification email template', ErrorCodes.NOTIFICATION_TEMPLATE_NOT_FOUND);
  return doc;
}

async function listVersions(notificationType, language) {
  return notificationEmailTemplateModel.findAllByTypeAndLanguage(notificationType, language);
}

async function getCurrent(notificationType, language) {
  const doc = await notificationEmailTemplateModel.findCurrent(notificationType, language);
  if (!doc) throw new NotFoundError('Notification email template', ErrorCodes.NOTIFICATION_TEMPLATE_NOT_FOUND);
  return doc;
}

async function getById(id) {
  const doc = await notificationEmailTemplateModel.findById(id);
  if (!doc) throw new NotFoundError('Notification email template', ErrorCodes.NOTIFICATION_TEMPLATE_NOT_FOUND);
  return doc;
}

async function listCurrent() {
  return notificationEmailTemplateModel.findAllCurrent();
}

// Builds the flat values object substituted into a template — derived from
// notification.metadata (the same data already stored for API consumers, no
// separate "template context" concept) plus a handful of values that can't
// be a raw metadata field: a CODE -> localized LABEL lookup, a formatted
// date/amount, or (for SUBSCRIPTION_RENEWAL_DUE) the operator's bank
// transfer details, which are static config, not per-notification data.
function buildValues(notificationType, language, notification) {
  const metadata = notification.metadata || {};

  switch (notificationType) {
    case 'PAYMENT_VERIFIED':
    case 'PAYMENT_REJECTED': {
      const purposeLabel = PURPOSE_LABELS[language][metadata.purpose] || PURPOSE_LABELS[language].INITIAL;
      const values = {
        purposeLabel,
        tier: metadata.tier,
        billingInterval: metadata.billingInterval,
        amount: parseFloat(metadata.amount).toFixed(2),
      };
      if (notificationType === 'PAYMENT_REJECTED') {
        values.reasonLabel = REJECTION_REASON_LABELS[language][metadata.rejectionReasonCode] || REJECTION_REASON_LABELS[language].OTHER;
      }
      return values;
    }
    case 'SUBSCRIPTION_RENEWAL_DUE':
      return {
        tier: metadata.tier,
        dueDate: moment(metadata.currentPeriodEnd).format('DD/MM/YYYY'),
        amount: parseFloat(metadata.amount).toFixed(2),
        paymentId: metadata.paymentId,
        bankName: config.bankTransfer.bankName,
        accountType: config.bankTransfer.accountType,
        accountNumber: config.bankTransfer.accountNumber,
        accountHolder: config.bankTransfer.accountHolder,
        identification: config.bankTransfer.identification,
      };
    case 'SUBSCRIPTION_EXPIRED':
      return { tier: metadata.previousTier };
    case 'PRICE_CHANGE_ANNOUNCED':
      return {
        tier: metadata.tier,
        billingInterval: metadata.billingInterval,
        currentPrice: parseFloat(metadata.previousPriceUsd).toFixed(2),
        newPrice: parseFloat(metadata.newPriceUsd).toFixed(2),
        effectiveDate: moment(metadata.effectiveAt).format('DD/MM/YYYY'),
      };
    default:
      throw new AppError(`No template value builder for notification type '${notificationType}'`, 500, ErrorCodes.NOTIFICATION_TEMPLATE_NOT_FOUND);
  }
}

// Resolves + renders the current template for (notification.type, language)
// into { subject, text, html }. Falls back to DEFAULT_LANGUAGE if the
// requested language has no published template (mirrors src/locales'
// getTranslations() fallback) — throws only if neither exists, which the
// NOTIFICATION_DISPATCH effect handler treats as a real failure (retried by
// reconciliation, same as any other transient send error) rather than
// silently dropping the email.
async function render(notificationType, language, notification) {
  let template = await notificationEmailTemplateModel.findCurrent(notificationType, language);
  let resolvedLanguage = language;
  if (!template && language !== DEFAULT_LANGUAGE) {
    template = await notificationEmailTemplateModel.findCurrent(notificationType, DEFAULT_LANGUAGE);
    resolvedLanguage = DEFAULT_LANGUAGE;
  }
  if (!template) {
    throw new NotFoundError('Notification email template', ErrorCodes.NOTIFICATION_TEMPLATE_NOT_FOUND);
  }

  const values = buildValues(notificationType, resolvedLanguage, notification);
  return {
    subject: substitute(template.subject_template, values),
    html: substituteHtml(template.html_template, values),
    text: substitute(template.text_template, values),
  };
}

module.exports = {
  EMAIL_TEMPLATE_TYPES,
  publish,
  activateVersion,
  listVersions,
  getCurrent,
  getById,
  listCurrent,
  render,
};
