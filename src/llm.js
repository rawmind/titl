import { languageName } from './languages.js';
import { TRANSLATEGEMMA_MODEL, isLocalUrl } from './settings.js';

const REQUEST_TIMEOUT_MS = 30_000;

export function chatUrl(base) {
  const url = new URL(base.trim());
  const path = url.pathname.replace(/\/+$/, '');
  if (!/\/chat\/completions$/.test(path)) url.pathname = /\/v1$/.test(path) ? `${path}/chat/completions` : `${path}/v1/chat/completions`;
  return url.href;
}

export function buildMessages({ text, before = [], after = [], source, target }) {
  const from = source && source !== 'auto' ? languageName(source) : null;
  const to = languageName(target);
  const system = [
    from ? `You translate video subtitles from ${from} to ${to}.` : `You translate video subtitles to ${to}.`,
    'The lines are fragments of continuous speech transcribed automatically, so a line may start or end mid-sentence and may contain recognition errors.',
    'Use the surrounding lines to get the meaning, grammar, gender and names right, and keep terms consistent with the earlier translations.',
    `Reply with the ${to} translation of the current line only, without quotes, notes or explanations.`,
  ].join(' ');
  const lines = [];
  if (before.length) {
    lines.push('Previous lines:');
    for (const line of before) lines.push(line.translation ? `- ${line.text} => ${line.translation}` : `- ${line.text}`);
  }
  lines.push('Current line (translate this):', text);
  if (after.length) {
    lines.push('Next lines (context only):');
    for (const line of after) lines.push(`- ${line}`);
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: lines.join('\n') },
  ];
}

function languageCode(code) {
  return code.replace('_', '-');
}

export function buildTranslateGemmaMessages({ text, source, target }) {
  const to = languageName(target);
  const toTag = `${to} (${languageCode(target)})`;
  const known = source && source !== 'auto';
  const from = known ? languageName(source) : null;
  const intro = known
    ? `You are a professional ${from} (${languageCode(source)}) to ${toTag} translator. Your goal is to accurately convey the meaning and nuances of the original ${from} text while adhering to ${to} grammar, vocabulary, and cultural sensitivities.`
    : `You are a professional translator into ${toTag}. Your goal is to accurately convey the meaning and nuances of the original text while adhering to ${to} grammar, vocabulary, and cultural sensitivities.`;
  const ask = known ? `Please translate the following ${from} text into ${to}:` : `Please translate the following text into ${to}:`;
  return [{ role: 'user', content: `${intro}\nProduce only the ${to} translation, without any additional explanations or commentary. ${ask}\n\n\n${text}` }];
}

export function cleanTranslation(content) {
  let text = String(content ?? '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const quoted = text.match(/^["“«„]([^"“”«»„]*)["”»“]$/);
  if (quoted) text = quoted[1].trim();
  return text;
}

const CLAUSE_END = /[,;:.!?…]["'»”)\]]*$/;

export function splitTranslation(translation, parts) {
  if (parts.length <= 1) return [translation];
  const words = String(translation ?? '').split(/\s+/).filter(Boolean);
  const weights = parts.map((p) => Math.max(1, String(p).trim().length));
  const total = weights.reduce((a, b) => a + b, 0);
  const ends = [];
  let length = 0;
  for (const w of words) ends.push((length += w.length + 1));
  const out = [];
  let from = 0;
  let share = 0;
  for (let k = 0; k < parts.length - 1; k++) {
    share += weights[k];
    const left = parts.length - 1 - k;
    if (words.length - from <= left) {
      out.push(words.slice(from, from + 1).join(' '));
      from = Math.min(words.length, from + 1);
      continue;
    }
    const goal = (share / total) * length;
    const slack = length / parts.length / 4;
    let best = from + 1;
    let bestScore = Infinity;
    for (let b = from + 1; b <= words.length - left; b++) {
      const score = Math.abs(ends[b - 1] - goal) - (CLAUSE_END.test(words[b - 1]) ? slack : 0);
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    out.push(words.slice(from, best).join(' '));
    from = best;
  }
  out.push(words.slice(from).join(' '));
  return out;
}

export async function translateWithLlm(config, { text, before, after }) {
  if (!isLocalUrl(config.llmUrl)) throw new Error('Model API URL must be http://127.0.0.1 or http://localhost');
  const url = chatUrl(config.llmUrl);
  const gemma = config.translationEngine === 'translategemma';
  const request = { text, before, after, source: config.language, target: config.translateTo };
  const body = {
    messages: gemma ? buildTranslateGemmaMessages(request) : buildMessages(request),
    temperature: gemma ? 0 : 0.2,
    max_tokens: 256,
    stream: false,
  };
  const model = config.llmModel || (gemma ? TRANSLATEGEMMA_MODEL : '');
  if (model) body.model = model;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new Error(`The model API at ${url} didn't answer within ${REQUEST_TIMEOUT_MS / 1000} s`);
    throw new Error(`Cannot reach the model API at ${url}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Model API returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const data = await res.json();
  return cleanTranslation(data.choices?.[0]?.message?.content);
}
