export const WHISPER_LANGUAGES = [
  'af', 'am', 'ar', 'as', 'az', 'ba', 'be', 'bg', 'bn', 'bo', 'br', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el',
  'en', 'es', 'et', 'eu', 'fa', 'fi', 'fo', 'fr', 'gl', 'gu', 'ha', 'haw', 'he', 'hi', 'hr', 'ht', 'hu', 'hy',
  'id', 'is', 'it', 'ja', 'jw', 'ka', 'kk', 'km', 'kn', 'ko', 'la', 'lb', 'ln', 'lo', 'lt', 'lv', 'mg', 'mi',
  'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'ne', 'nl', 'nn', 'no', 'oc', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru',
  'sa', 'sd', 'si', 'sk', 'sl', 'sn', 'so', 'sq', 'sr', 'su', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'tk', 'tl',
  'tr', 'tt', 'uk', 'ur', 'uz', 'vi', 'yi', 'yo', 'yue', 'zh',
];

export const TRANSLATION_TARGETS = [
  'en', 'zh', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'ru', 'id', 'de', 'ja', 'mr', 'te', 'tr', 'ta', 'vi', 'ko',
  'it', 'th', 'pl', 'uk', 'nl', 'ro', 'hu', 'el', 'cs', 'sv', 'bg', 'hr', 'sk', 'da', 'fi', 'no', 'lt', 'sl',
];

const BCP47 = { jw: 'jv' };

function displayName(code, inLocale) {
  try {
    const name = new Intl.DisplayNames([inLocale], { type: 'language' }).of(BCP47[code] ?? code);
    return name && name !== (BCP47[code] ?? code) ? name : null;
  } catch {
    return null;
  }
}

export function languageName(code) {
  const english = displayName(code, 'en') ?? code;
  return english.charAt(0).toUpperCase() + english.slice(1);
}

export function languageLabel(code) {
  const english = languageName(code);
  const native = displayName(code, BCP47[code] ?? code);
  return native && native.toLowerCase() !== english.toLowerCase() ? `${english} · ${native}` : english;
}

export function languageOptions() {
  return WHISPER_LANGUAGES.map((code) => ({ code, label: languageLabel(code), name: languageName(code) })).sort((a, b) =>
    a.name.localeCompare(b.name, 'en'),
  );
}

export function translationOptions() {
  return TRANSLATION_TARGETS.map((code) => ({ code, label: languageLabel(code) }));
}
