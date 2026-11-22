const SITE_LANGUAGES = {
  zh: 'zh', hi: 'hi', es: 'es', ar: 'ar', fr: 'fr', bn: 'bn', pt: 'pt', ru: 'ru', be: 'ru', kk: 'ru',
  id: 'id', in: 'id', ms: 'id', uk: 'uk', sr: 'sr', hr: 'sr', bs: 'sr', sh: 'sr', cnr: 'sr',
};

export const OS_ANCHORS = { mac: 'installation_macos', win: 'installation_windows', linux: 'installation_linux' };

export function installUrl(homepage, locale, os) {
  const slug = SITE_LANGUAGES[String(locale ?? '').toLowerCase().split(/[-_]/)[0]];
  return `${homepage}${slug ? `${slug}/` : ''}#${OS_ANCHORS[os] ?? 'install'}`;
}
