import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const locales = readdirSync(new URL('../_locales', import.meta.url));
const messages = Object.fromEntries(locales.map((l) => [l, JSON.parse(read(`_locales/${l}/messages.json`))]));
const english = messages.en;
const placeholders = (text) => [...text.matchAll(/\$\d/g)].map((m) => m[0]).sort().join(',');

test('twelve locales, English is the default', () => {
  assert.equal(locales.length, 12);
  assert.equal(JSON.parse(read('manifest.json')).default_locale, 'en');
});

test('every locale has every message with the same placeholders', () => {
  for (const [locale, table] of Object.entries(messages)) {
    assert.deepEqual(Object.keys(table).sort(), Object.keys(english).sort(), locale);
    for (const [key, { message }] of Object.entries(table)) {
      assert.ok(message.trim(), `${locale}.${key} is empty`);
      assert.equal(placeholders(message), placeholders(english[key].message), `${locale}.${key}`);
    }
  }
});

test('every message the UI uses exists', () => {
  const html = read('src/options.html') + read('src/popup.html');
  const fromHtml = [...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map((m) => m[1]);
  const code = ['src/options.js', 'src/popup.js', 'src/content.js'].map(read).join('\n');
  const fromCode = [...code.matchAll(/\bt\(\s*'([A-Za-z]+)'/g)].map((m) => m[1]);
  const manifest = [...read('manifest.json').matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]);
  for (const key of [...fromHtml, ...fromCode, ...manifest]) assert.ok(english[key], `missing message: ${key}`);
  assert.ok(fromHtml.length > 30 && fromCode.length > 20);
});
