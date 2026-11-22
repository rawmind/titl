import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LookaheadTranscriber } from '../src/lookahead.js';
import { Coverage } from '../src/coverage.js';
import { splitCue } from '../src/text.js';
import { DEFAULTS } from '../src/settings.js';

const SR = 16000;
const loud = (sec) => Float32Array.from({ length: sec * SR }, (_, i) => 0.3 * Math.sin(i / 5));
const silent = (sec) => new Float32Array(sec * SR);
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(responses) {
  const calls = [];
  const emitted = [];
  const t = new LookaheadTranscriber(
    { ...DEFAULTS, script: 'original' },
    {
      transcribe: async (samples) => {
        calls.push(samples.length / SR);
        return { segments: responses.shift() ?? [] };
      },
      onCues: (cues, from, to) => emitted.push({ cues, from, to }),
      onError: (err) => assert.fail(err),
    },
  );
  return { t, calls, emitted };
}

test('cues land on the video timeline; tail segment is retried next window', async () => {
  const { t, calls, emitted } = setup([
    [
      { start: 0, end: 3, text: 'Prva rečenica.' },
      { start: 3, end: 7.8, text: 'Druga koja je presečena' },
    ],
    [{ start: 0, end: 5, text: 'Druga koja je presečena na kraju.' }],
  ]);
  for (let i = 0; i < 16; i++) {
    t.addAudio({ t0: 100 + i, rate: 1, samples: loud(1) });
    await flush();
  }

  assert.deepEqual(calls.slice(0, 2), [8, 8]);
  assert.deepEqual(emitted[0].cues, [{ start: 100, end: 103, text: 'Prva rečenica.', src: 'Prva rečenica.' }]);
  assert.equal(emitted[0].to, 103);
  assert.equal(emitted[1].from, 103);
  assert.equal(emitted[1].cues[0].start, 103);
  assert.equal(emitted[1].cues[0].text, 'Druga koja je presečena na kraju.');
});

test('when behind, one larger window replaces a backlog', async () => {
  const { t, calls } = setup([[{ start: 0, end: 11, text: 'Dugačak prozor.' }]]);
  for (let i = 0; i < 20; i++) t.addAudio({ t0: i, rate: 1, samples: loud(1) });
  await flush();
  assert.equal(calls[0], DEFAULTS.maxWindowSec);
});

test('silent windows advance coverage without calling whisper', async () => {
  const { t, calls, emitted } = setup([]);
  for (let i = 0; i < 8; i++) t.addAudio({ t0: i, rate: 1, samples: silent(1) });
  await flush();
  assert.deepEqual(calls, []);
  assert.deepEqual(emitted, [{ cues: [], from: 0, to: 8 }]);
});

test('a seek (time jump) restarts the timeline at the new position', async () => {
  const { t, emitted } = setup([[{ start: 0, end: 2, text: 'Posle skoka.' }]]);
  for (let i = 0; i < 3; i++) t.addAudio({ t0: i, rate: 1, samples: loud(1) });
  for (let i = 0; i < 8; i++) t.addAudio({ t0: 500 + i, rate: 1, samples: loud(1) });
  await flush();
  assert.equal(emitted[0].from, 500);
  assert.equal(emitted[0].cues[0].start, 500);
});

test('playback rate scales whisper timestamps to video time', async () => {
  const { t, emitted } = setup([[{ start: 2, end: 4, text: 'Brže.' }]]);
  for (let i = 0; i < 8; i++) t.addAudio({ t0: 10 + i * 1.5, rate: 1.5, samples: loud(1) });
  await flush();
  assert.deepEqual(emitted[0].cues[0], { start: 13, end: 16, text: 'Brže.', src: 'Brže.' });
});

test('finish flushes a short final window', async () => {
  const { t, calls, emitted } = setup([[{ start: 0, end: 2.5, text: 'Kraj.' }]]);
  for (let i = 0; i < 3; i++) t.addAudio({ t0: 50 + i, rate: 1, samples: loud(1) });
  await flush();
  assert.deepEqual(calls, []);
  t.finish();
  await flush();
  assert.deepEqual(calls, [3]);
  assert.equal(emitted[0].to, 53);
});

test('Cyrillic cues carry Latin source text for the translator', async () => {
  const t = new LookaheadTranscriber(
    { ...DEFAULTS, language: 'sr', script: 'cyrillic' },
    {
      transcribe: async () => ({ segments: [{ start: 0, end: 2, text: 'Dobar dan.' }] }),
      onCues: (cues) => {
        assert.equal(cues[0].text, 'Добар дан.');
        assert.equal(cues[0].src, 'Dobar dan.');
      },
      onError: (err) => assert.fail(err),
    },
  );
  for (let i = 0; i < 8; i++) t.addAudio({ t0: i, rate: 1, samples: loud(1) });
  await flush();
});

test('coverage merges adjacent ranges and answers lookups', () => {
  const c = new Coverage();
  c.add(0, 8);
  c.add(8.2, 15);
  c.add(40, 50);
  assert.deepEqual(c.ranges, [[0, 15], [40, 50]]);
  assert.equal(c.endAt(5), 15);
  assert.equal(c.endAt(39.5), 50);
  assert.equal(c.endAt(20), null);
});

test('splitCue keeps short cues and splits long ones proportionally', () => {
  assert.deepEqual(splitCue({ start: 1, end: 2, text: 'kratko' }), [{ start: 1, end: 2, text: 'kratko' }]);
  const parts = splitCue({ start: 0, end: 10, text: 'reč '.repeat(40).trim() });
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.text.length <= 84));
  assert.equal(parts[0].start, 0);
  assert.equal(parts.at(-1).end, 10);
});

test('auto language: detected Serbian gets the chosen script and is sent until locked', async () => {
  const requested = [];
  const detected = [];
  const emitted = [];
  const t = new LookaheadTranscriber(
    { ...DEFAULTS, language: 'auto', script: 'latin' },
    {
      transcribe: async (_samples, language) => {
        requested.push(language);
        return { language: 'serbian', segments: [{ start: 0, end: 2, text: 'Добар дан.' }] };
      },
      onCues: (cues) => emitted.push(...cues),
      onError: (err) => assert.fail(err),
      onLanguage: (language) => detected.push(language),
    },
  );
  for (let i = 0; i < 40; i++) {
    t.addAudio({ t0: i, rate: 1, samples: loud(1) });
    await flush();
  }
  assert.deepEqual(requested.slice(0, 4), ['auto', 'auto', 'auto', 'sr']);
  assert.deepEqual(detected, ['sr']);
  assert.equal(emitted[0].text, 'Dobar dan.');
});
