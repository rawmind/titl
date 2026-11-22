import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSLATION_TARGETS,
  WHISPER_LANGUAGES,
  languageLabel,
  languageName,
  languageOptions,
  translationOptions,
} from '../src/languages.js';
import { DEFAULTS, validateSettings } from '../src/settings.js';

test('every Whisper language is a valid setting and listed once', () => {
  assert.equal(new Set(WHISPER_LANGUAGES).size, WHISPER_LANGUAGES.length);
  for (const code of WHISPER_LANGUAGES) assert.equal(validateSettings({ ...DEFAULTS, language: code }), null, code);
});

test('languages get readable names', () => {
  assert.equal(languageName('sr'), 'Serbian');
  assert.equal(languageName('jw'), 'Javanese');
  assert.equal(languageLabel('sr'), 'Serbian · српски');
  assert.equal(languageLabel('en'), 'English');
  assert.ok(languageOptions().every(({ name, code }) => name !== code), 'every language has a name');
});

test('options are sorted by English name and the default detects the language', () => {
  const names = languageOptions().map((o) => o.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en')));
  assert.equal(DEFAULTS.language, 'auto');
  assert.ok(languageOptions().some((o) => o.code === 'sr'));
});

test('translation targets keep their popularity order and are valid settings', () => {
  assert.deepEqual(translationOptions().map((o) => o.code), TRANSLATION_TARGETS);
  assert.deepEqual(TRANSLATION_TARGETS.slice(0, 4), ['en', 'zh', 'hi', 'es']);
  assert.equal(new Set(TRANSLATION_TARGETS).size, TRANSLATION_TARGETS.length);
  for (const code of TRANSLATION_TARGETS) {
    assert.equal(validateSettings({ ...DEFAULTS, translateTo: code }), null, code);
    assert.notEqual(languageName(code), code, code);
  }
});
