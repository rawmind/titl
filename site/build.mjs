import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://rawmind.github.io/titl/';
const REPO = 'https://github.com/rawmind/titl';
const GA_ID = 'G-EDP0HX0XPS';

export const LANGUAGES = [
  { slug: 'en', htmlLang: 'en', ogLocale: 'en_US', name: 'English', match: ['en'] },
  { slug: 'zh', htmlLang: 'zh-CN', ogLocale: 'zh_CN', name: '中文', match: ['zh'] },
  { slug: 'hi', htmlLang: 'hi', ogLocale: 'hi_IN', name: 'हिन्दी', match: ['hi'] },
  { slug: 'es', htmlLang: 'es', ogLocale: 'es_ES', name: 'Español', match: ['es'] },
  { slug: 'ar', htmlLang: 'ar', ogLocale: 'ar_AR', name: 'العربية', match: ['ar'], rtl: true },
  { slug: 'fr', htmlLang: 'fr', ogLocale: 'fr_FR', name: 'Français', match: ['fr'] },
  { slug: 'bn', htmlLang: 'bn', ogLocale: 'bn_BD', name: 'বাংলা', match: ['bn'] },
  { slug: 'pt', htmlLang: 'pt-BR', ogLocale: 'pt_BR', name: 'Português', match: ['pt'] },
  { slug: 'ru', htmlLang: 'ru', ogLocale: 'ru_RU', name: 'Русский', match: ['ru', 'be', 'kk'] },
  { slug: 'id', htmlLang: 'id', ogLocale: 'id_ID', name: 'Bahasa Indonesia', match: ['id', 'in', 'ms'] },
  { slug: 'uk', htmlLang: 'uk', ogLocale: 'uk_UA', name: 'Українська', match: ['uk'] },
  { slug: 'sr', htmlLang: 'sr-Latn', ogLocale: 'sr_RS', name: 'Srpski', match: ['sr', 'hr', 'bs', 'sh', 'cnr'] },
];

const LINKS = {
  store: 'https://chromewebstore.google.com/detail/titl/bpapgchpopccpbgbkfldmdmfmddgoeme',
  github: REPO,
  release: `${REPO}/releases/latest`,
  winExe: `${REPO}/releases/latest/download/titl-windows-x64.exe`,
  guide: `${REPO}#install`,
  llmGuide: `${REPO}#local-llm`,
  changelog: `${REPO}/blob/master/CHANGELOG.md`,
  privacy: `${REPO}/blob/master/PRIVACY.md`,
  security: `${REPO}/blob/master/SECURITY.md`,
  kofi: 'https://ko-fi.com/rwmnd',
  video: 'https://www.youtube.com/watch?v=uu_h3BTFQjA',
  whisperCpp: 'https://github.com/ggml-org/whisper.cpp',
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export function loadStrings() {
  return Object.fromEntries(
    readdirSync(join(here, 'i18n'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(join(here, 'i18n', f), 'utf8'))]),
  );
}

const urlFor = (slug) => (slug === 'en' ? SITE : `${SITE}${slug}/`);
const withLinks = (text) => text.replace(/\{(\w+)\}/g, (m, key) => LINKS[key] ?? m);
const escapeAttr = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const jsonLd = (lang, strings) =>
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Titl',
    description: strings.metaDesc,
    url: urlFor(lang.slug),
    inLanguage: lang.htmlLang,
    applicationCategory: 'BrowserApplication',
    operatingSystem: 'macOS, Windows, Linux',
    image: `${SITE}icons/icon128.png`,
    screenshot: `${SITE}store/screenshot-1-subtitles.png`,
    installUrl: LINKS.store,
    license: `${REPO}/blob/master/LICENSE`,
    isAccessibleForFree: true,
    sameAs: [LINKS.github, LINKS.store],
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  }).replace(/</g, '\\u003c');

export function render(template, lang, strings) {
  const base = lang.slug === 'en' ? '' : '../';
  const alternates = [
    ...LANGUAGES.map((l) => `  <link rel="alternate" hreflang="${l.slug}" href="${urlFor(l.slug)}">`),
    `  <link rel="alternate" hreflang="x-default" href="${SITE}">`,
  ].join('\n');
  const languageLinks = LANGUAGES.map((l) => {
    const href = `${base}${l.slug === 'en' ? '' : `${l.slug}/`}`;
    const current = l.slug === lang.slug ? ' aria-current="page"' : '';
    return `          <li><a href="${href || './'}" hreflang="${l.htmlLang}" lang="${l.htmlLang}" data-slug="${l.slug}"${current}>${l.name}</a></li>`;
  }).join('\n');
  const values = {
    ...LINKS,
    ...Object.fromEntries(Object.entries(strings).map(([k, v]) => [k, withLinks(v)])),
    htmlLang: lang.htmlLang,
    dir: lang.rtl ? 'rtl' : 'ltr',
    ogLocale: lang.ogLocale,
    slug: lang.slug,
    url: urlFor(lang.slug),
    site: SITE,
    gaId: GA_ID,
    base,
    alternates,
    jsonLd: jsonLd(lang, strings),
    languageLinks,
    languageName: lang.name,
    langsJson: JSON.stringify(LANGUAGES.map(({ slug, match }) => ({ slug, match }))),
  };
  for (const key of ['title', 'metaDesc', 'shotAlt', 'scrYoutubeAlt', 'scrPopupAlt', 'scrOptionsAlt', 'scrLlmAlt', 'close', 'language', 's2Title']) {
    values[key] = escapeAttr(strings[key]);
  }
  return template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in values)) throw new Error(`${lang.slug}: missing ${key}`);
    return values[key];
  });
}

export function build(out = join(root, 'dist', 'site')) {
  const template = readFileSync(join(here, 'template.html'), 'utf8');
  const strings = loadStrings();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'store'), { recursive: true });
  mkdirSync(join(out, 'icons'), { recursive: true });
  for (const lang of LANGUAGES) {
    const dir = lang.slug === 'en' ? out : join(out, lang.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), render(template, lang, strings[lang.slug]));
  }
  cpSync(join(here, 'style.css'), join(out, 'style.css'));
  for (const f of readdirSync(join(root, 'store')).filter((f) => f.endsWith('.png'))) {
    cpSync(join(root, 'store', f), join(out, 'store', f));
  }
  cpSync(join(here, 'img'), join(out, 'img'), { recursive: true });
  for (const f of readdirSync(join(root, 'icons')).filter((f) => f.endsWith('.png') || f === 'icon.svg')) {
    cpSync(join(root, 'icons', f), join(out, 'icons', f));
  }
  const sitemap = LANGUAGES.map((l) => `  <url><loc>${urlFor(l.slug)}</loc></url>`).join('\n');
  writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap}\n</urlset>\n`);
  writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`Built ${build()}`);
