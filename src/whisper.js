import { encodeWav } from './audio.js';

export const SAMPLE_RATE = 16000;

export async function transcribe(config, samples, { verbose = false, signal } = {}) {
  const form = new FormData();
  form.append('file', new Blob([encodeWav(samples, SAMPLE_RATE)], { type: 'audio/wav' }), 'window.wav');
  form.append('language', config.language);
  form.append('response_format', verbose ? 'verbose_json' : 'json');
  form.append('temperature', '0');

  const timeout = AbortSignal.timeout(config.requestTimeoutSec * 1000);
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
  return json;
}
