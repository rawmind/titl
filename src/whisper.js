import { encodeWav } from './audio.js';

export const SAMPLE_RATE = 16000;
const AUDIO_CTX_PER_SEC = 50;
const AUDIO_CTX_MAX = 1500;
const AUDIO_CTX_MARGIN_SEC = 1;
const AUDIO_CTX_MIN = 300;
const SLOW_RATIO = 0.5;

export function audioContext(seconds) {
  const ctx = Math.ceil((seconds + AUDIO_CTX_MARGIN_SEC) * AUDIO_CTX_PER_SEC);
  return Math.min(AUDIO_CTX_MAX, Math.max(AUDIO_CTX_MIN, ctx));
}

export class Pace {
  constructor(onRecord = () => {}) {
    this.slow = false;
    this.onRecord = onRecord;
  }

  audioContext(seconds) {
    return this.slow ? audioContext(seconds) : 0;
  }

  record(seconds, elapsedMs) {
    if (elapsedMs > seconds * SLOW_RATIO * 1000) this.slow = true;
    this.onRecord({ audioSec: seconds, requestMs: Math.round(elapsedMs), shortContext: this.slow });
  }
}

export async function transcribe(config, samples, { verbose = false, signal, language = config.language, pace } = {}) {
  const seconds = samples.length / SAMPLE_RATE;
  const form = new FormData();
  form.append('file', new Blob([encodeWav(samples, SAMPLE_RATE)], { type: 'audio/wav' }), 'window.wav');
  form.append('language', language);
  form.append('response_format', verbose ? 'verbose_json' : 'json');
  form.append('no_language_probabilities', 'true');
  const audioCtx = pace?.audioContext(seconds) ?? 0;
  if (audioCtx) form.append('audio_ctx', String(audioCtx));
  form.append('temperature', '0');

  const timeout = AbortSignal.timeout(config.requestTimeoutSec * 1000);
  const started = performance.now();
  let res;
  try {
    res = await fetch(config.serverUrl, {
      method: 'POST',
      body: form,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('whisper-server timed out');
    if (err instanceof TypeError) throw new Error(`Cannot reach whisper-server at ${config.serverUrl}`);
    throw err;
  }
  if (!res.ok) throw new Error(`whisper-server returned HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`whisper-server: ${json.error}`);
  pace?.record(seconds, performance.now() - started);
  return json;
}
