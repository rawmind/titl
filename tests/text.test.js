import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Transcript, cleanText, findNewStart, toCyrillic, toLatin, tokenize } from '../src/text.js';
import { AUTO, SCRIPT, SERBIAN, scriptFor } from '../src/settings.js';

test('Cyrillic to Latin, including digraphs and case', () => {
  assert.equal(toLatin('Мислим да је ово веома важно за нашу економију.'), 'Mislim da je ovo veoma važno za našu ekonomiju.');
  assert.equal(toLatin('Људи, Њујорк и ЏЕП, ЉУДИ, Ђорђе, ћуприја'), 'Ljudi, Njujork i DŽEP, LJUDI, Đorđe, ćuprija');
  assert.equal(toLatin('Already latin, 2025.'), 'Already latin, 2025.');
});

test('Latin to Cyrillic, including digraphs and case', () => {
  assert.equal(toCyrillic('Mislim da je ovo veoma važno.'), 'Мислим да је ово веома важно.');
  assert.equal(toCyrillic('Ljudi, Njujork, džep, LJUDI, Đorđe'), 'Људи, Њујорк, џеп, ЉУДИ, Ђорђе');
});

test('mixed-script windows still dedup after transliteration', () => {
  const t = new Transcript();
  t.append(toLatin('Мислим да је ово веома важно'));
  assert.equal(t.append(toLatin('ovo veoma važno za našu ekonomiju')), 'za našu ekonomiju');
});

test('PRD example: overlapping prefix is dropped', () => {
  const t = new Transcript();
  assert.equal(t.append('Mislim da je ovo veoma važno'), 'Mislim da je ovo veoma važno');
  assert.equal(t.append('ovo veoma važno za našu ekonomiju'), 'za našu ekonomiju');
});

test('tolerates punctuation, case and diacritics', () => {
  const prev = tokenize('Mislim da je ovo veoma važno.');
  const cur = tokenize('Veoma vazno, za našu ekonomiju');
  assert.equal(findNewStart(prev, cur), 2);
});

test('tolerates Cyrillic vs Latin output', () => {
  const prev = tokenize('Mislim da je ovo veoma važno');
  const cur = tokenize('ово веома важно за нашу економију');
  assert.equal(findNewStart(prev, cur), 3);
});

test('skips a garbled word cut at the window start', () => {
  const prev = tokenize('Danas govorimo o ekonomiji Srbije');
  const cur = tokenize('mija ekonomiji Srbije i regiona');
  assert.equal(findNewStart(prev, cur), 3);
});

test('skips a garbled last word of the previous window', () => {
  const prev = tokenize('Danas govorimo o ekonomiji Srb');
  const cur = tokenize('o ekonomiji Srbije i regiona');
  assert.equal(findNewStart(prev, cur), 2);
});

test('window fully contained in previous text adds nothing', () => {
  const t = new Transcript();
  t.append('Ovo je prva rečenica i druga rečenica');
  assert.equal(t.append('i druga rečenica'), '');
});

test('no overlap appends everything', () => {
  const t = new Transcript();
  t.append('Prva tema');
  assert.equal(t.append('Sasvim nešto drugo'), 'Sasvim nešto drugo');
});

test('short single-word coincidence is not treated as overlap', () => {
  const prev = tokenize('rekao je da');
  const cur = tokenize('da li je to tačno');
  assert.equal(findNewStart(prev, cur), 0);
});

test('cleanText strips annotations and known hallucinations', () => {
  assert.equal(cleanText(' [Muzika] Dobro  veče (aplauz) '), 'Dobro veče');
  assert.equal(cleanText('Hvala na pažnji.'), '');
  assert.equal(cleanText('♪'), '');
});

test('the saved Serbian script applies only when Serbian is chosen, otherwise Latin', () => {
  assert.equal(scriptFor({ language: SERBIAN, script: SCRIPT.CYRILLIC }), SCRIPT.CYRILLIC);
  assert.equal(scriptFor({ language: AUTO, script: SCRIPT.CYRILLIC }), SCRIPT.LATIN);
});
