import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioContext } from '../src/whisper.js';

test('whisper encodes the window plus a second, at least 6 s and at most 30 s', () => {
  assert.equal(audioContext(8), 450);
  assert.equal(audioContext(11), 600);
  assert.equal(audioContext(12), 650);
  assert.equal(audioContext(0.3), 300);
  assert.equal(audioContext(5), 300);
  assert.equal(audioContext(29), 1500);
  assert.equal(audioContext(60), 1500);
});

test('a fast machine keeps the full context; a slow one switches to the short one for good', async () => {
  const { Pace } = await import('../src/whisper.js');
  const pace = new Pace();
  assert.equal(pace.audioContext(10), 0);
  pace.record(10, 4000);
  assert.equal(pace.audioContext(10), 0);
  pace.record(10, 16000);
  assert.equal(pace.audioContext(10), 550);
  pace.record(10, 100);
  assert.equal(pace.audioContext(8), 450);
});

test('lookahead requests wrap segments between words; live requests are unchanged', async () => {
  const { transcribe } = await import('../src/whisper.js');
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push(init.body);
    return new Response(JSON.stringify({ text: '', segments: [] }));
  };
  try {
    const config = { serverUrl: 'http://127.0.0.1:8080/inference', language: 'sr', requestTimeoutSec: 5 };
    await transcribe(config, new Float32Array(16000), { verbose: true });
    await transcribe(config, new Float32Array(16000));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(sent[0].get('response_format'), 'verbose_json');
  assert.equal(sent[0].get('split_on_word'), 'true');
  assert.equal(sent[1].get('response_format'), 'json');
  assert.equal(sent[1].get('split_on_word'), null);
});
