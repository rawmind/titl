import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGUAGES, loadStrings, render } from '../site/build.mjs';

const template = readFileSync(new URL('../site/template.html', import.meta.url), 'utf8');
const strings = loadStrings();

const tags = (text) => [...text.matchAll(/<\/?(\w+)|\{\w+\}/g)].map((m) => m[0]).sort().join(' ');

test('website has the extension\'s 12 languages with the same strings', () => {
  assert.equal(LANGUAGES.length, 12);
  assert.deepEqual(Object.keys(strings).sort(), LANGUAGES.map((l) => l.slug).sort());
  for (const lang of LANGUAGES) {
    const table = strings[lang.slug];
    assert.deepEqual(Object.keys(table).sort(), Object.keys(strings.en).sort(), lang.slug);
    for (const [key, value] of Object.entries(table)) {
      assert.ok(value.trim(), `${lang.slug}.${key} is empty`);
      assert.equal(tags(value), tags(strings.en[key]), `${lang.slug}.${key} has different markup`);
    }
  }
});

test('Arabic renders right to left', () => {
  const html = render(template, LANGUAGES.find((l) => l.slug === 'ar'), strings.ar);
  assert.match(html, /<html lang="ar" dir="rtl">/);
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

test('every page links to every language and marks its own', () => {
  for (const lang of LANGUAGES) {
    const html = render(template, lang, strings[lang.slug]);
    const links = [...html.matchAll(/<li><a href="([^"]+)" hreflang="[^"]+" lang="[^"]+" data-slug="(\w+)"( aria-current="page")?>/g)];
    assert.equal(links.length, LANGUAGES.length, lang.slug);
    assert.deepEqual(links.filter((m) => m[3]).map((m) => m[2]), [lang.slug]);
    const ru = links.find((m) => m[2] === 'ru')[1];
    assert.equal(ru, lang.slug === 'en' ? 'ru/' : '../ru/', lang.slug);
  }
});

test('install tabs are wired to their panels and the redirect runs in the head', () => {
  const html = render(template, LANGUAGES[0], strings.en);
  for (const os of ['mac', 'win', 'linux']) {
    assert.match(html, new RegExp(`role="tab" id="tab-${os}" aria-controls="panel-${os}"`));
    assert.match(html, new RegExp(`role="tabpanel" id="panel-${os}" aria-labelledby="tab-${os}"`));
  }
  assert.ok(html.indexOf('location.replace') < html.indexOf('</head>'));
});

test('Google Analytics loads only after consent', () => {
  const html = render(template, LANGUAGES[0], strings.en);
  assert.doesNotMatch(html, /<script[^>]+googletagmanager/);
  assert.match(html, /const GA_ID = 'G-EDP0HX0XPS';/);
  assert.match(html, /if \(readConsent\(\) === 'yes'\) loadAnalytics\(\);/);
});
