import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { installUrl } from '../src/site.js';
import { LANGUAGES } from '../site/build.mjs';

const home = 'https://rawmind.github.io/titl/';
const page = (slug) => (slug === 'en' ? home : `${home}${slug}/`);

test('the helper download link opens the site in the UI language at the right OS', () => {
  assert.equal(installUrl(home, 'ru', 'mac'), 'https://rawmind.github.io/titl/ru/#installation_macos');
  assert.equal(installUrl(home, 'pt-BR', 'win'), 'https://rawmind.github.io/titl/pt/#installation_windows');
  assert.equal(installUrl(home, 'zh_CN', 'linux'), 'https://rawmind.github.io/titl/zh/#installation_linux');
  assert.equal(installUrl(home, 'en-US', 'mac'), 'https://rawmind.github.io/titl/#installation_macos');
  assert.equal(installUrl(home, 'ru', 'cros'), 'https://rawmind.github.io/titl/ru/#install');
});

test('every website language and its aliases lead to that language page', () => {
  for (const { slug, match } of LANGUAGES) {
    for (const code of match) {
      for (const locale of [code, code.toUpperCase(), `${code}-XX`, `${code}_XX`]) {
        assert.equal(installUrl(home, locale, 'mac'), `${page(slug)}#installation_macos`, locale);
      }
    }
  }
});

test('every extension locale has its own website page', () => {
  const locales = readdirSync(new URL('../_locales', import.meta.url));
  for (const locale of locales) {
    const lang = locale.split('_')[0];
    const slug = LANGUAGES.find((l) => l.match.includes(lang))?.slug;
    assert.ok(slug, `${locale} has no website language`);
    assert.equal(installUrl(home, locale, 'win'), `${page(slug)}#installation_windows`, locale);
  }
});

test('languages the website lacks fall back to the English page', () => {
  for (const locale of ['de', 'ja', 'ko', 'it-IT', 'pl', 'tr', 'xx', '', undefined, null]) {
    assert.equal(installUrl(home, locale, 'linux'), `${home}#installation_linux`, String(locale));
  }
});
