import { AUTO } from './settings.js';

export { AUTO };

export const VOTES_TO_LOCK = 3;

const WHISPER_NAMES = {
  english: 'en', chinese: 'zh', german: 'de', spanish: 'es', russian: 'ru', korean: 'ko', french: 'fr', japanese: 'ja',
  portuguese: 'pt', turkish: 'tr', polish: 'pl', catalan: 'ca', dutch: 'nl', arabic: 'ar', swedish: 'sv', italian: 'it',
  indonesian: 'id', hindi: 'hi', finnish: 'fi', vietnamese: 'vi', hebrew: 'he', ukrainian: 'uk', greek: 'el', malay: 'ms',
  czech: 'cs', romanian: 'ro', danish: 'da', hungarian: 'hu', tamil: 'ta', norwegian: 'no', thai: 'th', urdu: 'ur',
  croatian: 'hr', bulgarian: 'bg', lithuanian: 'lt', latin: 'la', maori: 'mi', malayalam: 'ml', welsh: 'cy', slovak: 'sk',
  telugu: 'te', persian: 'fa', latvian: 'lv', bengali: 'bn', serbian: 'sr', azerbaijani: 'az', slovenian: 'sl', kannada: 'kn',
  estonian: 'et', macedonian: 'mk', breton: 'br', basque: 'eu', icelandic: 'is', armenian: 'hy', nepali: 'ne', mongolian: 'mn',
  bosnian: 'bs', kazakh: 'kk', albanian: 'sq', swahili: 'sw', galician: 'gl', marathi: 'mr', punjabi: 'pa', sinhala: 'si',
  khmer: 'km', shona: 'sn', yoruba: 'yo', somali: 'so', afrikaans: 'af', occitan: 'oc', georgian: 'ka', belarusian: 'be',
  tajik: 'tg', sindhi: 'sd', gujarati: 'gu', amharic: 'am', yiddish: 'yi', lao: 'lo', uzbek: 'uz', faroese: 'fo',
  'haitian creole': 'ht', pashto: 'ps', turkmen: 'tk', nynorsk: 'nn', maltese: 'mt', sanskrit: 'sa', luxembourgish: 'lb',
  myanmar: 'my', tibetan: 'bo', tagalog: 'tl', malagasy: 'mg', assamese: 'as', tatar: 'tt', hawaiian: 'haw', lingala: 'ln',
  hausa: 'ha', bashkir: 'ba', javanese: 'jw', sundanese: 'su', cantonese: 'yue',
};

const WHISPER_CODES = new Set(Object.values(WHISPER_NAMES));

export function detectedLanguage(result) {
  const value = String(result?.language ?? '').trim().toLowerCase();
  if (WHISPER_CODES.has(value)) return value;
  return WHISPER_NAMES[value] ?? null;
}

export class LanguageLock {
  constructor(language) {
    this.auto = language === AUTO;
    this.fixed = this.auto ? null : language;
    this.reset();
  }

  reset() {
    this.votes = new Map();
    this.locked = this.fixed;
    this.leader = this.fixed;
  }

  get detecting() {
    return this.locked === null;
  }

  get request() {
    return this.locked ?? AUTO;
  }

  get current() {
    return this.locked ?? this.leader;
  }

  observe(result) {
    if (!this.detecting) return false;
    if (Array.isArray(result?.segments) && !result.segments.length) return false;
    const code = detectedLanguage(result);
    if (!code) return false;
    const before = this.current;
    const votes = (this.votes.get(code) ?? 0) + 1;
    this.votes.set(code, votes);
    if (votes >= (this.votes.get(this.leader) ?? 0)) this.leader = code;
    if (votes >= VOTES_TO_LOCK) this.locked = code;
    return this.current !== before;
  }
}
