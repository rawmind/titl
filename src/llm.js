import { languageName } from './languages.js';
import { isLocalUrl } from './settings.js';

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

export async function translateWithLlm(config, { text, before, after }) {
  if (!isLocalUrl(config.llmUrl)) throw new Error('Model API URL must be http://127.0.0.1 or http://localhost');
  const url = chatUrl(config.llmUrl);
  const body = {
    messages: buildMessages({ text, before, after, source: config.language, target: config.translateTo }),
    temperature: 0.2,
    max_tokens: 256,
    stream: false,
  };
  if (config.llmModel) body.model = config.llmModel;
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
