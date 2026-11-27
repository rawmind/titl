import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ERROR_CHARS, MAX_ERRORS, describeErrors, pushError } from '../src/errors.js';

test('only the last 10 errors are kept, newest last', () => {
  let list = [];
  for (let i = 0; i < 25; i++) list = pushError(list, { source: 'whisper request', message: `failure ${i}`, at: i });
  assert.equal(list.length, MAX_ERRORS);
  assert.equal(list[0].message, 'failure 15');
  assert.equal(list.at(-1).message, 'failure 24');
});

test('a repeated error is counted instead of pushing the others out', () => {
  let list = pushError([], { source: 'scout capture', message: 'boom', at: 1 });
  list = pushError(list, { source: 'whisper request', message: 'timed out', at: 2 });
  list = pushError(list, { source: 'whisper request', message: 'timed out', at: 3 });
  list = pushError(list, { source: 'whisper request', message: 'timed out', at: 4 });
  assert.equal(list.length, 2);
  assert.deepEqual(list[1], { at: 4, source: 'whisper request', message: 'timed out', count: 3 });
});

test('long messages, sources and multi-line text are clipped to one bounded line', () => {
  const [entry] = pushError([], { source: 'x'.repeat(500), message: `line one\n\n${'y'.repeat(5000)}`, at: 0 });
  assert.equal(entry.message.length, MAX_ERROR_CHARS);
  assert.ok(entry.message.startsWith('line one y'));
  assert.ok(entry.message.endsWith('…'));
  assert.equal(entry.source.length, 40);
  assert.ok(!/\n/.test(entry.message));
});

test('a stored list that is corrupt or oversized is handled', () => {
  assert.equal(pushError(undefined, { source: 's', message: 'm', at: 0 }).length, 1);
  assert.equal(pushError(Array(50).fill({ source: 'a', message: 'b', at: 0, count: 1 }), { source: 's', message: 'm', at: 0 }).length, MAX_ERRORS);
  assert.equal(pushError([], { source: '', message: '', at: 0 })[0].message, 'unknown error');
  assert.deepEqual(describeErrors(null), []);
});

test('debug rows list the newest error first with its time and repeat count', () => {
  const at = new Date(2026, 10, 26, 19, 5, 7).getTime();
  const rows = describeErrors([
    { at, source: 'scout capture', message: 'old', count: 1 },
    { at, source: 'whisper request', message: 'timed out', count: 3 },
  ]);
  assert.deepEqual(rows, [
    ['19:05:07 whisper request', 'timed out (×3)'],
    ['19:05:07 scout capture', 'old'],
  ]);
});
