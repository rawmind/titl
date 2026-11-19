export const DEFAULTS = {
  serverUrl: 'http://127.0.0.1:8080/inference',
  autoStartServer: true,
  language: 'sr',
  script: 'latin',
  mode: 'lookahead',
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
  if (!/^[a-z]{2,3}$/.test(s.language)) return 'Language must be a Whisper language code, e.g. "sr"';
  if (!['latin', 'cyrillic', 'original'].includes(s.script)) return 'Unknown script';
  if (!['lookahead', 'live'].includes(s.mode)) return 'Unknown mode';
  if (!(s.minLeadSec >= 0 && s.maxLeadSec > s.minLeadSec + s.lookaheadWindowSec)) {
    return 'Max lead must exceed min lead plus the lookahead window';
  }
  if (!(s.stepSec > 0 && s.windowSec > s.stepSec)) return 'Window must be longer than step';
  if (!(s.maxWindowSec >= Math.max(s.windowSec, s.lookaheadWindowSec))) {
    return 'Max window must be at least the window size';
  }
  return null;
}
