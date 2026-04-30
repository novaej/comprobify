const en = require('./en');
const es = require('./es');

const SUPPORTED_LANGUAGES = ['es', 'en'];
const DEFAULT_LANGUAGE = 'es';

const locales = { en, es };

function getTranslations(lang) {
  return locales[lang] || locales[DEFAULT_LANGUAGE];
}

module.exports = { getTranslations, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE };
