export const AUTO = 'auto';
export const SERBIAN = 'sr';
export const CROATIAN = 'hr';
export const ENGINE = Object.freeze({ CHROME: 'chrome', LLM: 'llm' });
export const MODE = Object.freeze({ LOOKAHEAD: 'lookahead', LIVE: 'live' });
export const SCRIPT = Object.freeze({ LATIN: 'latin', CYRILLIC: 'cyrillic', ORIGINAL: 'original' });

export const DEFAULTS = {
  serverUrl: 'http://127.0.0.1:8080/inference',
  autoStartServer: true,
  language: AUTO,
  script: SCRIPT.LATIN,
  translateTo: '',
  translationEngine: ENGINE.CHROME,
  llmUrl: 'http://127.0.0.1:8081/v1',
  llmModel: '',
  showOriginal: true,
  blurTranslation: false,
  subtitleSize: 100,
  skipAds: false,
  mode: MODE.LOOKAHEAD,
  showEarlySec: 0.3,
  minLeadSec: 3,
  maxLeadSec: 45,
  lookaheadWindowSec: 8,
  windowSec: 6,
  stepSec: 4,
  maxWindowSec: 12,
  lagThresholdSec: 10,
  silenceRms: 0.004,
  requestTimeoutSec: 30,
};

export function scriptFor(config) {
  return config.language === SERBIAN ? config.script : DEFAULTS.script;
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...settings };
}

export function isLocalUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
}

export function validateSettings(s) {
  if (!isLocalUrl(s.serverUrl)) return 'Server URL must be http://127.0.0.1 or http://localhost';
  if (!/^([a-z]{2,3}|auto)$/.test(s.language)) return 'Language must be a Whisper language code, e.g. "sr"';
  if (!Object.values(SCRIPT).includes(s.script)) return 'Unknown script';
  if (!Object.values(MODE).includes(s.mode)) return 'Unknown mode';
  if (!/^([a-z]{2,3}(-[A-Za-z]{2,4})?)?$/.test(s.translateTo)) return 'Unknown translation language';
  if (!(s.subtitleSize >= 50 && s.subtitleSize <= 300)) return 'Subtitle size must be between 50% and 300%';
  if (!Object.values(ENGINE).includes(s.translationEngine)) return 'Unknown translator';
  if (s.translationEngine === ENGINE.LLM && !isLocalUrl(s.llmUrl)) return 'Model API URL must be http://127.0.0.1 or http://localhost';
  if (s.translationEngine === ENGINE.LLM && !/^[\w.:/@-]*$/.test(s.llmModel)) return 'Model name may only contain letters, digits and . : / @ - _';
  if (!(s.minLeadSec >= 0 && s.maxLeadSec > s.minLeadSec + s.lookaheadWindowSec)) {
    return 'Max lead must exceed min lead plus the lookahead window';
  }
  if (!(s.stepSec > 0 && s.windowSec > s.stepSec)) return 'Window must be longer than step';
  if (!(s.maxWindowSec >= Math.max(s.windowSec, s.lookaheadWindowSec))) {
    return 'Max window must be at least the window size';
  }
  return null;
}

export const TRANSLATOR_SOURCE_FALLBACK = { sr: 'hr', bs: 'hr' };
