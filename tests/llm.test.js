import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, buildTranslateGemmaMessages, chatUrl, cleanTranslation, splitTranslation, translateWithLlm } from '../src/llm.js';
import { DEFAULTS, validateSettings } from '../src/settings.js';

test('chat URL accepts a server root, a /v1 base or the full endpoint', () => {
  assert.equal(chatUrl('http://127.0.0.1:8081'), 'http://127.0.0.1:8081/v1/chat/completions');
  assert.equal(chatUrl('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(chatUrl('http://localhost:1234/v1/chat/completions'), 'http://localhost:1234/v1/chat/completions');
});

test('prompt names both languages and carries the surrounding lines', () => {
  const [system, user] = buildMessages({
    text: 'da je ovo veoma važno',
    before: [{ text: 'Mislim', translation: 'I think' }, { text: 'Dobro veče', translation: '' }],
    after: ['za našu ekonomiju.'],
    source: 'sr',
    target: 'en',
  });
  assert.match(system.content, /from Serbian to English/);
  assert.equal(
    user.content,
    [
      'Previous lines:',
      '- Mislim => I think',
      '- Dobro veče',
      'Current line (translate this):',
      'da je ovo veoma važno',
      'Next lines (context only):',
      '- za našu ekonomiju.',
    ].join('\n'),
  );
});

test('prompt without context is just the current line', () => {
  const [, user] = buildMessages({ text: 'Zdravo', source: 'sr', target: 'en' });
  assert.equal(user.content, 'Current line (translate this):\nZdravo');
});

test('model output is cleaned of reasoning, quotes and line breaks', () => {
  assert.equal(cleanTranslation('<think>hmm</think>\n"that this is very\nimportant"'), 'that this is very important');
  assert.equal(cleanTranslation('«Bonjour»'), 'Bonjour');
  assert.equal(cleanTranslation(undefined), '');
});

test('translation request goes to the OpenAI-compatible endpoint', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: ' Good evening ' } }] }));
  });
  const config = { ...DEFAULTS, translateTo: 'en', llmModel: 'gemma3:4b' };
  assert.equal(await translateWithLlm(config, { text: 'Dobro veče' }), 'Good evening');
  assert.equal(calls[0].url, 'http://127.0.0.1:8081/v1/chat/completions');
  assert.equal(calls[0].body.model, 'gemma3:4b');
  assert.equal(calls[0].body.stream, false);
});

test('unreachable or failing model API gives a readable error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(translateWithLlm({ ...DEFAULTS, translateTo: 'en' }, { text: 'x' }), /Cannot reach the model API/);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response('model not found', { status: 404 }));
  await assert.rejects(translateWithLlm({ ...DEFAULTS, translateTo: 'en' }, { text: 'x' }), /returned 404: model not found/);
});

test('LLM settings are validated', () => {
  assert.equal(validateSettings({ ...DEFAULTS, translationEngine: 'llm' }), null);
  assert.match(validateSettings({ ...DEFAULTS, translationEngine: 'cloud' }), /Unknown translator/);
  assert.match(validateSettings({ ...DEFAULTS, translationEngine: 'llm', llmUrl: 'https://api.example.com/v1' }), /Model API URL/);
});

test('chat URL keeps a query string out of the path', () => {
  assert.equal(chatUrl('http://127.0.0.1:8081/v1?key=1'), 'http://127.0.0.1:8081/v1/chat/completions?key=1');
});

test('cut-off reasoning and inner quotes are handled', () => {
  assert.equal(cleanTranslation('<think>The user wants a translation of'), '');
  assert.equal(cleanTranslation('"Come here," she said. "Now."'), '"Come here," she said. "Now."');
});

test('requests never go to a non-local model API', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  await assert.rejects(translateWithLlm({ ...DEFAULTS, translateTo: 'en', llmUrl: 'https://api.example.com/v1' }, { text: 'x' }), /must be http:\/\/127\.0\.0\.1/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('a slow model API is reported as a timeout, not as unreachable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError');
  });
  await assert.rejects(translateWithLlm({ ...DEFAULTS, translateTo: 'en' }, { text: 'x' }), /didn't answer within 30 s/);
});

test('hidden local LLM fields never block saving with the Chrome translator', () => {
  assert.equal(validateSettings({ ...DEFAULTS, translationEngine: 'chrome', llmUrl: 'not a url', llmModel: 'bad model' }), null);
  assert.match(validateSettings({ ...DEFAULTS, translationEngine: 'llm', llmModel: 'bad model' }), /Model name/);
});

test('before the spoken language is detected, the prompt names only the target', () => {
  const [system] = buildMessages({ text: 'Hola', source: 'auto', target: 'en' });
  assert.match(system.content, /^You translate video subtitles to English\./);
});

test('TranslateGemma gets its own single-message prompt with language names and codes', () => {
  const messages = buildTranslateGemmaMessages({ text: 'Dobar dan, kako ste?', source: 'sr', target: 'en' });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.equal(
    messages[0].content,
    'You are a professional Serbian (sr) to English (en) translator. Your goal is to accurately convey the meaning and nuances of the original Serbian text while adhering to English grammar, vocabulary, and cultural sensitivities.\nProduce only the English translation, without any additional explanations or commentary. Please translate the following Serbian text into English:\n\n\nDobar dan, kako ste?',
  );
  assert.match(buildTranslateGemmaMessages({ text: 'x', source: 'auto', target: 'pt-BR' })[0].content, /^You are a professional translator into .+ \(pt-BR\)\./);
});

test('TranslateGemma defaults to translategemma:4b with greedy decoding', async () => {
  let body;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Good afternoon, how are you?' } }] }));
  };
  try {
    const config = { ...DEFAULTS, translationEngine: 'translategemma', llmUrl: 'http://127.0.0.1:11434/v1', language: 'sr', translateTo: 'en' };
    assert.equal(await translateWithLlm(config, { text: 'Dobar dan, kako ste?' }), 'Good afternoon, how are you?');
    assert.equal(body.model, 'translategemma:4b');
    assert.equal(body.temperature, 0);
    assert.equal(body.messages.length, 1);
    assert.equal(validateSettings(config), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a sentence translation is split back across its cues by length', () => {
  const parts = ['Danas ćemo razgovarati o budžetu za sledeću godinu i o tome šta je', 'najvažnije za naše građane.'];
  const pieces = splitTranslation('Today we will discuss the budget for next year and what is most important for our citizens.', parts);
  assert.equal(pieces.length, 2);
  assert.equal(pieces.join(' '), 'Today we will discuss the budget for next year and what is most important for our citizens.');
  assert.ok(pieces[0].length > pieces[1].length);
});

test('the split prefers a clause boundary near the proportional point', () => {
  assert.deepEqual(splitTranslation('Good evening, thank you all for coming tonight.', ['Dobro veče,', 'hvala svima što ste došli večeras.']), [
    'Good evening,',
    'thank you all for coming tonight.',
  ]);
});

test('a single cue keeps the whole translation and short ones never lose words', () => {
  assert.deepEqual(splitTranslation('Hello there.', ['Zdravo.']), ['Hello there.']);
  assert.deepEqual(splitTranslation('Yes.', ['Da,', 'naravno.']), ['Yes.', '']);
});
