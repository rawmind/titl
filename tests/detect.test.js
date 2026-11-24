import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO, LanguageLock, VOTES_TO_LOCK, detectedLanguage } from '../src/detect.js';
import { WHISPER_LANGUAGES } from '../src/languages.js';

test('whisper-server language names map to codes', () => {
  assert.equal(detectedLanguage({ language: 'serbian' }), 'sr');
  assert.equal(detectedLanguage({ language: 'Haitian Creole' }), 'ht');
  assert.equal(detectedLanguage({ language: 'yue' }), 'yue');
  assert.equal(detectedLanguage({ language: 'unknown' }), null);
  assert.equal(detectedLanguage({}), null);
});

test('every language whisper detects is one Titl offers', () => {
  for (const code of WHISPER_LANGUAGES) assert.equal(detectedLanguage({ language: code }), code);
});

test('a fixed language is never re-detected', () => {
  const lock = new LanguageLock('sr');
  assert.equal(lock.detecting, false);
  assert.equal(lock.request, 'sr');
  assert.equal(lock.observe({ language: 'croatian' }), false);
  assert.equal(lock.current, 'sr');
});

test('auto follows the most detected language, then locks it', () => {
  const lock = new LanguageLock(AUTO);
  assert.equal(lock.current, null);
  assert.equal(lock.observe({ language: 'croatian' }), true);
  assert.equal(lock.current, 'hr');
  assert.equal(lock.observe({ language: 'serbian' }), true);
  assert.equal(lock.observe({ language: 'serbian' }), false);
  assert.equal(lock.observe({ language: 'croatian' }), true);
  assert.equal(lock.current, 'hr');
  assert.equal(lock.request, AUTO);
  lock.observe({ language: 'serbian' });
  assert.equal(VOTES_TO_LOCK, 3);
  assert.equal(lock.detecting, false);
  assert.equal(lock.request, 'sr');
  assert.equal(lock.observe({ language: 'english' }), false);
  assert.equal(lock.current, 'sr');
});

test('reset starts detecting again', () => {
  const lock = new LanguageLock(AUTO);
  for (let i = 0; i < VOTES_TO_LOCK; i++) lock.observe({ language: 'german' });
  assert.equal(lock.request, 'de');
  lock.reset();
  assert.equal(lock.request, AUTO);
  assert.equal(lock.current, null);
});

test('a reply without speech is not a vote for its language', () => {
  const lock = new LanguageLock('auto');
  for (let i = 0; i < 5; i++) assert.equal(lock.observe({ language: 'english', text: '', segments: [] }), false);
  assert.equal(lock.detecting, true);
  assert.equal(lock.current, null);
  for (let i = 0; i < 3; i++) lock.observe({ language: 'serbian', segments: [{ start: 0, end: 1, text: 'Da.' }] });
  assert.equal(lock.current, 'sr');
  assert.equal(lock.detecting, false);
});
