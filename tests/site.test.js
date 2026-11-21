import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGUAGES, loadStrings, render } from '../site/build.mjs';

const template = readFileSync(new URL('../site/template.html', import.meta.url), 'utf8');
const strings = loadStrings();

test('website has English and Russian with the same strings', () => {
  assert.deepEqual(LANGUAGES.map((l) => l.slug), ['en', 'ru']);
  assert.deepEqual(Object.keys(strings).sort(), ['en', 'ru']);
  assert.deepEqual(Object.keys(strings.ru).sort(), Object.keys(strings.en).sort());
  for (const [key, value] of Object.entries(strings.ru)) assert.ok(value.trim(), `ru.${key} is empty`);
});

test('every page renders with no placeholder left', () => {
  for (const lang of LANGUAGES) {
    const html = render(template, lang, strings[lang.slug]);
    assert.doesNotMatch(html, /\{\{\w+\}\}|\{(store|release|guide|privacy|kofi|video)\}/, lang.slug);
    assert.match(html, new RegExp(`<html lang="${lang.htmlLang}"`));
    assert.match(html, /hreflang="ru" href="https:\/\/rawmind\.github\.io\/titl\/ru\/"/);
  }
});

test('Russian page loads assets from the site root', () => {
  const html = render(template, LANGUAGES.find((l) => l.slug === 'ru'), strings.ru);
  assert.match(html, /href="\.\.\/style\.css"/);
  assert.match(html, /src="\.\.\/store\/screenshot-1-subtitles\.png"/);
});
