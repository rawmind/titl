export const DEFAULTS = {
  serverUrl: 'http://127.0.0.1:8080/inference',
  // Launch whisper-server through the native helper when nothing answers at serverUrl.
  autoStartServer: true,
  language: 'sr',
  // Serbian only: 'latin' | 'cyrillic' | 'original' (as returned by Whisper).
  script: 'latin',
  // 'lookahead': a hidden muted tab plays the video ahead so subtitles are ready in
  // time. 'live': transcribe the tab's own audio (always used for live streams).
  mode: 'lookahead',
  // Lookahead: show each subtitle this much before its timestamp.
  showEarlySec: 0.3,
  // Lookahead: pause the video until this much is transcribed ahead (0 = never pause).
  minLeadSec: 3,
  // Lookahead: stop the hidden tab once it is this far ahead of the video.
  maxLeadSec: 45,
  lookaheadWindowSec: 8,
  windowSec: 6,
  stepSec: 4,
  // When inference falls behind, windows grow up to this length; older audio is skipped.
  maxWindowSec: 12,
  lagThresholdSec: 10,
  // Windows quieter than this RMS are not sent (Whisper hallucinates on silence).
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
