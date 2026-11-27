import { MODE } from './settings.js';

export function formatDebugInfo(sections) {
  return sections
    .map(([title, rows]) => {
      const lines = rows.filter(([, value]) => value != null && value !== '').map(([key, value]) => `${key}: ${value}`);
      return [`[${title}]`, ...(lines.length ? lines : ['-'])].join('\n');
    })
    .join('\n\n');
}

export function describeTiming(timing) {
  if (!timing) return null;
  const ratio = timing.requestMs / 1000 / timing.audioSec;
  return `${(timing.requestMs / 1000).toFixed(1)} s for ${timing.audioSec.toFixed(1)} s of audio (${ratio.toFixed(2)}× real time)`;
}

const GPU_MAX_RATIO = 0.2;
const CPU_MIN_RATIO = 0.5;

export function estimateBackend(timing) {
  if (!timing) return 'unknown: start subtitles once, or update the helper for the exact answer';
  const ratio = timing.requestMs / 1000 / timing.audioSec;
  const guess = ratio <= GPU_MAX_RATIO ? 'probably GPU' : ratio >= CPU_MIN_RATIO ? 'probably CPU' : 'unclear';
  return `${guess} (estimated from speed, ${ratio.toFixed(2)}× real time; update the helper for the exact answer)`;
}

export function browserFromBrands(brands) {
  const names = ['Microsoft Edge', 'Opera', 'Brave', 'Google Chrome', 'Chromium'];
  for (const name of names) {
    const brand = brands?.find((b) => b.brand === name);
    if (brand) return `${name.replace('Google ', '').replace('Microsoft ', '')} ${brand.version}`;
  }
  return null;
}

export function browserName(userAgent) {
  const match =
    userAgent.match(/(Edg|OPR|Brave)\/([\d.]+)/) ?? userAgent.match(/(Chrome)\/([\d.]+)/) ?? userAgent.match(/(\w+)\/([\d.]+)$/);
  if (!match) return userAgent;
  const names = { Edg: 'Edge', OPR: 'Opera' };
  return `${names[match[1]] ?? match[1]} ${match[2]}`;
}

function ago(at, now) {
  return at ? `${((now - at) / 1000).toFixed(1)} s ago` : 'never';
}

function clock(t) {
  return Number.isFinite(t) ? `${t.toFixed(1)} s` : '?';
}

function playback({ time, paused, ad }) {
  return [clock(time), paused ? 'paused' : 'playing', ad ? 'ad' : null].filter(Boolean).join(', ');
}

export function describeLookahead(state, info, now = Date.now()) {
  if (state?.mode !== MODE.LOOKAHEAD || state.status !== 'running') return [];
  if (!info) return [['problem', 'the background worker has no lookahead session; stop and start subtitles again']];
  const capture = info.scout?.capture;
  const t = info.transcriber ?? {};
  const lead = info.main && info.coveredTo != null ? info.coveredTo - info.main.time : null;
  return [
    ['running for', ago(info.startedAt, now).replace(' ago', '')],
    ['video', info.videoId],
    ['main tab', info.main ? playback(info.main) : 'no report yet'],
    ['scout tab', info.scout ? `${playback(info.scout)}${info.scout.videoId !== info.videoId ? `, other video ${info.scout.videoId}` : ''}` : 'no report yet'],
    ['scout reports', `${info.scoutStates}, last ${ago(info.scoutAt, now)}`],
    ['scout capture', capture ? `track ${capture.track ?? 'none'}, ${capture.reads} frames read, ${capture.blocks} blocks, ${capture.sent} sent, ${capture.recaptures ?? 0} re-captures` : 'not reported (old scout script?)'],
    ['scout capture error', capture?.error],
    ['audio received', `${info.audioBlocks} blocks, ${info.audioSec.toFixed(1)} s, last ${ago(info.audioAt, now)}`],
    ['audio for another video', info.otherVideoAudio || null],
    ['audio waiting for a window', `${(t.buffered ?? 0).toFixed(1)} s`],
    ['whisper requests', `${t.requests ?? 0} sent, ${t.failures ?? 0} failed, ${t.silent ?? 0} silent windows skipped`],
    ['last request error', t.lastError ? `${t.lastError} (${ago(t.lastErrorAt, now)})` : null],
    ['subtitles ready ahead', lead != null ? `${lead.toFixed(1)} s` : 'none'],
    ['subtitle lines', info.cues],
    ['scout seeks', info.seeks],
  ];
}

const SERBIAN_MODEL_LANGUAGES = ['sr', 'hr'];

function fileName(path) {
  return path?.split(/[\\/]/).at(-1);
}

export function modelName(path) {
  return fileName(path)?.replace(/^ggml-/, '').replace(/\.bin$/, '') ?? null;
}

export function modelFor(helper, language) {
  if (!helper?.model) return null;
  const serbian = SERBIAN_MODEL_LANGUAGES.includes(language) && helper.serbian_model;
  return modelName(serbian || helper.model);
}

export function serbianOffer(helper, language) {
  if (!helper || helper.problem) return { show: false, model: null, reason: `hidden: helper ${helper?.problem ?? 'did not answer'}` };
  if (!('serbian_model' in helper)) {
    const model = helper.version ? `not used with ${fileName(helper.model) ?? 'this model'} (only with small)` : null;
    return { show: false, model, reason: helper.version ? 'hidden: the helper does not run small' : 'hidden: helper is older than this feature' };
  }
  if (helper.serbian_model) return { show: false, model: helper.serbian_model, reason: 'hidden: already downloaded' };
  if (!SERBIAN_MODEL_LANGUAGES.includes(language)) return { show: false, model: 'not downloaded', reason: `hidden: spoken language is ${language}, not sr or hr` };
  return { show: true, model: 'not downloaded', reason: 'shown' };
}
