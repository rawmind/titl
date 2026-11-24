import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LANGUAGES, build, loadStrings, render } from '../site/build.mjs';

const template = readFileSync(new URL('../site/template.html', import.meta.url), 'utf8');
const strings = loadStrings();
const SITE = 'https://rawmind.github.io/titl/';

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
    assert.doesNotMatch(html, /\{\{\w+\}\}|\{(store|release|guide|llmGuide|privacy|kofi|video|whisperCpp)\}/, lang.slug);
    assert.match(html, new RegExp(`<html lang="${lang.htmlLang}"`));
    assert.match(html, /hreflang="ru" href="https:\/\/rawmind\.github\.io\/titl\/ru\/"/);
  }
});

test('Russian page loads assets from the site root', () => {
  const html = render(template, LANGUAGES.find((l) => l.slug === 'ru'), strings.ru);
  assert.match(html, /href="\.\.\/style\.css"/);
  assert.match(html, /src="\.\.\/img\/screenshot-1-subtitles-1280\.webp"/);
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

test('each OS has an install anchor that opens its tab', () => {
  for (const anchor of ['installation_macos', 'installation_windows', 'installation_linux']) assert.match(template, new RegExp(anchor));
});

test('search titles and descriptions are unique and within the length limits', () => {
  for (const key of ['title', 'metaDesc']) {
    assert.equal(new Set(LANGUAGES.map((l) => strings[l.slug][key])).size, LANGUAGES.length, key);
  }
  for (const { slug } of LANGUAGES) {
    assert.ok([...strings[slug].title].length <= 65, `${slug} title`);
    assert.ok([...strings[slug].metaDesc].length <= 160, `${slug} description`);
    assert.match(strings[slug].title, /YouTube/);
    assert.match(strings[slug].title, / · Titl$/);
  }
});

test('every page lists the same language alternates, including itself', () => {
  const expected = [...LANGUAGES.map((l) => `${l.slug} ${l.slug === 'en' ? '' : `${l.slug}/`}`), 'x-default '];
  for (const lang of LANGUAGES) {
    const html = render(template, lang, strings[lang.slug]);
    const found = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="https:\/\/rawmind\.github\.io\/titl\/([^"]*)">/g)];
    assert.deepEqual(found.map((m) => `${m[1]} ${m[2]}`), expected, lang.slug);
  }
});

test('structured data is valid JSON, describes the page and claims no rating', () => {
  for (const lang of LANGUAGES) {
    const html = render(template, lang, strings[lang.slug]);
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    assert.equal(data['@type'], 'SoftwareApplication');
    assert.equal(data.description, strings[lang.slug].metaDesc);
    assert.equal(data.inLanguage, lang.htmlLang);
    assert.equal(data.offers.price, 0);
    assert.equal('aggregateRating' in data, false);
    assert.ok(html.includes(`<link rel="canonical" href="${data.url}">`), lang.slug);
  }
});

test('every site file a page refers to is in the built site', () => {
  const out = mkdtempSync(join(tmpdir(), 'titl-site-'));
  try {
    build(out);
    for (const lang of LANGUAGES) {
      const dir = lang.slug === 'en' ? out : join(out, lang.slug);
      const html = readFileSync(join(dir, 'index.html'), 'utf8');
      const tags = html.match(/<(?:img|link rel="(?:icon|stylesheet)")[^>]*>/g);
      const files = tags.flatMap((tag) => [
        ...[...tag.matchAll(/ (?:src|href)="([^"]+)"/g)].map((m) => m[1]),
        ...[...tag.matchAll(/ srcset="([^"]+)"/g)].flatMap((m) => m[1].split(',').map((c) => c.trim().split(' ')[0])),
      ]);
      assert.ok(files.length > 10, lang.slug);
      for (const f of files) assert.ok(existsSync(join(dir, f)), `${lang.slug}: ${f}`);
      const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
      const ogImage = html.match(/<meta property="og:image" content="([^"]+)">/)[1];
      for (const url of [ogImage, data.image, data.screenshot]) {
        assert.ok(url.startsWith(SITE), `${lang.slug}: ${url}`);
        assert.ok(existsSync(join(out, url.slice(SITE.length))), `${lang.slug}: ${url}`);
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('WebP screenshots match the store screenshots they were made from', () => {
  const sources = JSON.parse(readFileSync(new URL('./screenshots.json', import.meta.url), 'utf8'));
  for (const [name, hash] of Object.entries(sources)) {
    const png = readFileSync(new URL(`../store/${name}`, import.meta.url));
    const help = `${name} changed: run scripts/screenshots.sh`;
    assert.equal(createHash('sha256').update(png).digest('hex'), hash, help);
    for (const width of [640, 1280]) {
      assert.ok(existsSync(new URL(`../site/img/${name.replace('.png', `-${width}.webp`)}`, import.meta.url)), help);
    }
  }
});
