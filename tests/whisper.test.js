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
