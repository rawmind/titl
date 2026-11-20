import { DEFAULTS, TRANSLATOR_SOURCE_FALLBACK, isLocalUrl, loadSettings, validateSettings } from './settings.js';
import { languageOptions, translationOptions } from './languages.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['serverUrl', 'autoStartServer', 'mode', 'showEarlySec', 'minLeadSec', 'language', 'script', 'translateTo', 'showOriginal', 'blurTranslation', 'skipAds', 'windowSec', 'stepSec', 'maxWindowSec', 'lagThresholdSec'];

function fill(settings) {
  for (const f of FIELDS) {
    if ($(f).type === 'checkbox') $(f).checked = settings[f];
    else $(f).value = settings[f];
  }
}

function syncScriptRow() {
  $('scriptRow').hidden = $('language').value !== 'sr';
}

function read() {
  const out = {};
  for (const f of FIELDS) {
    const el = $(f);
    out[f] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim();
  }
  return out;
}

function say(el, text, ok) {
  el.textContent = text;
  el.className = ok ? 'ok' : 'error';
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const settings = { ...(await loadSettings()), ...read() };
  const error = validateSettings(settings);
  if (error) return say($('message'), error, false);
  await chrome.storage.local.set({ settings });
  say($('message'), 'Saved.', true);
  const res = await chrome.runtime.sendMessage({ target: 'background', type: 'restart' }).catch(() => null);
  if (res?.restarted) say($('message'), 'Saved and applied to the running subtitles.', true);
  else if (res && !res.ok) say($('message'), `Saved, but restarting failed: ${res.error}`, false);
});

$('reset').addEventListener('click', async () => {
  await chrome.storage.local.remove('settings');
  fill(DEFAULTS);
  syncScriptRow();
  say($('message'), 'Defaults restored.', true);
});

$('test').addEventListener('click', async () => {
  const url = $('serverUrl').value.trim();
  if (!isLocalUrl(url)) return say($('testResult'), 'Not a local http URL', false);
  say($('testResult'), 'Testing…', true);
  try {
    const res = await fetch(url, { method: 'POST', body: new FormData(), signal: AbortSignal.timeout(5000) });
    if (res.status === 404) return say($('testResult'), 'Server is up, but this path returns 404', false);
    say($('testResult'), `Reachable (HTTP ${res.status})`, true);
  } catch {
    say($('testResult'), 'Cannot reach server', false);
  }
});

$('prepareTranslation').addEventListener('click', async () => {
  const out = $('translationResult');
  const language = $('language').value.trim();
  const target = $('translateTo').value;
  if (!target) return say(out, 'Choose a language to translate to first', false);
  if (!('Translator' in self)) return say(out, 'Translator is not available here; it will download on your first click in a YouTube tab', false);
  try {
    let pair = null;
    for (const source of [language, TRANSLATOR_SOURCE_FALLBACK[language]]) {
      if (!source || source === target) continue;
      if ((await Translator.availability({ sourceLanguage: source, targetLanguage: target })) !== 'unavailable') {
        pair = { sourceLanguage: source, targetLanguage: target };
        break;
      }
    }
    if (!pair) return say(out, `Chrome can't translate ${language} → ${target} on this device`, false);
    say(out, 'Preparing…', true);
    const translator = await Translator.create({
      ...pair,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => say(out, `Downloading… ${Math.round(e.loaded * 100)}%`, true));
      },
    });
    const sample = await translator.translate('Dobar dan, kako ste?');
    translator.destroy();
    say(out, `Ready (${pair.sourceLanguage} → ${pair.targetLanguage}): "Dobar dan, kako ste?" → "${sample}"`, true);
  } catch (err) {
    say(out, `Failed: ${err.message}`, false);
  }
});

for (const { code, label } of languageOptions()) $('language').add(new Option(label, code));
for (const { code, label } of translationOptions()) $('translateTo').add(new Option(label, code));
fill(await loadSettings());
syncScriptRow();
$('language').addEventListener('change', syncScriptRow);
