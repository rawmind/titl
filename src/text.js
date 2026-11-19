// Text cleanup and overlap deduplication for consecutive overlapping windows.

// Whisper may answer in either Serbian script; compare both as plain ASCII Latin.
const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'dj', е: 'e', ж: 'z', з: 'z', и: 'i',
  ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', ћ: 'c', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', џ: 'dz', ш: 's',
};

export function normalizeToken(token) {
  return token
    .toLowerCase()
    .replace(/[Ѐ-ӿ]/g, (c) => CYRILLIC[c] ?? c)
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// Whisper switches between Serbian Cyrillic and Latin from window to window, so
// output is transliterated into one script. Both alphabets map one-to-one, except
// that Latin digraphs (lj, nj, dž) are rarely two separate letters, e.g. "injekcija".
const TO_LATIN = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z', и: 'i',
  ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', ћ: 'ć', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'č', џ: 'dž', ш: 'š',
};
const TO_CYRILLIC = Object.fromEntries(Object.entries(TO_LATIN).map(([cyr, lat]) => [lat, cyr]));

function matchCase(source, replacement) {
  if (source === source.toLowerCase()) return replacement;
  // "LJUDI" → "ЉУДИ" but "Ljudi" → "Људи"; single uppercase letters capitalize.
  return source === source.toUpperCase() && source.length > 1
    ? replacement.toUpperCase()
    : replacement[0].toUpperCase() + replacement.slice(1);
}

export function toLatin(text) {
  return text.replace(/[Ѐ-ӿ]/g, (c, i) => {
    const lat = TO_LATIN[c.toLowerCase()];
    if (!lat || c === c.toLowerCase()) return lat ?? c;
    // Uppercase digraph: all caps if the next letter is also uppercase (ЉУДИ → LJUDI).
    const next = text[i + 1];
    const allCaps = next && next !== next.toLowerCase();
    return allCaps ? lat.toUpperCase() : lat[0].toUpperCase() + lat.slice(1);
  });
}

export function toCyrillic(text) {
  return text.replace(/d[žŽ]|l[jJ]|n[jJ]|[a-zčćđšž]/giu, (s) => {
    const cyr = TO_CYRILLIC[s.toLowerCase()];
    return cyr ? matchCase(s, cyr) : s;
  });
}

export function applyScript(text, script) {
  if (script === 'latin') return toLatin(text);
  if (script === 'cyrillic') return toCyrillic(text);
  return text;
}

export function tokenize(text) {
  return text.trim().split(/\s+/).filter((t) => normalizeToken(t) !== '');
}

// Phrases Whisper tends to invent on music, silence or window edges.
const HALLUCINATIONS = [
  /^hvala (vam )?(na (pažnji|gledanju)|što ste gledali)\.?$/i,
  /^(титлови|titlovi|prevod|subtitles|субтитри)\b/i,
  /^(продолжиће се|nastaviće se)\.*$/i,
  /^\.+$/,
];

export function cleanText(text) {
  const cleaned = text
    .replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return HALLUCINATIONS.some((re) => re.test(cleaned)) ? '' : cleaned;
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokensMatch(a, b) {
  return a === b || (a.length >= 5 && b.length >= 5 && editDistanceAtMostOne(a, b));
}

/**
 * Returns the index in `cur` where genuinely new tokens begin, by finding the longest
 * run where a suffix of `prev` equals a prefix of `cur`. A few edge tokens on either
 * side may be skipped, since words cut at a window boundary are often garbled.
 */
export function findNewStart(prev, cur, { maxSkipPrev = 1, maxSkipCur = 2, minMatch = 2 } = {}) {
  const p = prev.map(normalizeToken);
  const c = cur.map(normalizeToken);
  for (let k = Math.min(p.length, c.length); k >= 1; k--) {
    for (let j = 0; j <= maxSkipPrev; j++) {
      const pStart = p.length - j - k;
      if (pStart < 0) continue;
      for (let i = 0; i <= maxSkipCur && i + k <= c.length; i++) {
        // A single-token overlap only counts if it is long and exactly at the seam.
        if (k < minMatch && !(i === 0 && j === 0 && c[0].length >= 5)) continue;
        let ok = true;
        for (let t = 0; t < k && ok; t++) ok = tokensMatch(p[pStart + t], c[i + t]);
        if (ok) return i + k;
      }
    }
  }
  return 0;
}

/** Splits a long cue into readable pieces, timed in proportion to their length. */
export function splitCue({ start, end, text }, maxChars = 84) {
  const parts = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if (cur && cur.length + 1 + word.length > maxChars) {
      parts.push(cur);
      cur = word;
    } else {
      cur = cur ? `${cur} ${word}` : word;
    }
  }
  if (cur) parts.push(cur);

  const totalChars = parts.reduce((n, p) => n + p.length, 0);
  let t = start;
  return parts.map((p) => {
    const d = ((end - start) * p.length) / totalChars;
    const cue = { start: t, end: t + d, text: p };
    t += d;
    return cue;
  });
}

export class Transcript {
  constructor({ context = 40, keep = 200 } = {}) {
    this.context = context;
    this.keep = keep;
    this.tokens = [];
  }

  /** Appends a window's text and returns only the part not already transcribed. */
  append(text) {
    const cur = tokenize(text);
    if (!cur.length) return '';
    const added = cur.slice(findNewStart(this.tokens.slice(-this.context), cur));
    this.tokens.push(...added);
    if (this.tokens.length > this.keep) this.tokens = this.tokens.slice(-this.context);
    return added.join(' ');
  }

  reset() {
    this.tokens = [];
  }
}
