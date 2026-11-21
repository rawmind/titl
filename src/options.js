import { DEFAULTS, TRANSLATOR_SOURCE_FALLBACK, isLocalUrl, loadSettings, validateSettings } from './settings.js';
import { languageOptions, translationOptions } from './languages.js';
import { localizePage, t, uiLocale } from './i18n.js';
import { translateWithLlm } from './llm.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['serverUrl', 'autoStartServer', 'mode', 'showEarlySec', 'minLeadSec', 'language', 'script', 'translateTo', 'translationEngine', 'llmUrl', 'llmModel', 'showOriginal', 'blurTranslation', 'subtitleSize', 'skipAds', 'windowSec', 'stepSec', 'maxWindowSec', 'lagThresholdSec'];

function fill(settings) {
  for (const f of FIELDS) {
    if ($(f).type === 'checkbox') $(f).checked = settings[f];
    else $(f).value = settings[f];
  }
}

function syncScriptRow() {
  $('scriptRow').hidden = $('language').value !== 'sr';
}

function syncEngineRows() {
  const llm = $('translationEngine').value === 'llm';
  $('llmRows').hidden = !llm;
  $('llmUrl').disabled = $('llmModel').disabled = !llm;
  $('chromeHint').hidden = llm;
  $('prepareTranslation').textContent = t(llm ? 'testConnection' : 'downloadModel');
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
  say($('message'), t('saved'), true);
  const res = await chrome.runtime.sendMessage({ target: 'background', type: 'restart' }).catch(() => null);
  if (res?.restarted) say($('message'), t('savedApplied'), true);
  else if (res && !res.ok) say($('message'), t('savedRestartFailed', res.error), false);
});

$('reset').addEventListener('click', async () => {
  await chrome.storage.local.remove('settings');
  fill(DEFAULTS);
  syncScriptRow();
  syncEngineRows();
  say($('message'), t('defaultsRestored'), true);
});

$('test').addEventListener('click', async () => {
  const url = $('serverUrl').value.trim();
  if (!isLocalUrl(url)) return say($('testResult'), t('notLocalUrl'), false);
  say($('testResult'), t('testing'), true);
  try {
    const res = await fetch(url, { method: 'POST', body: new FormData(), signal: AbortSignal.timeout(5000) });
    if (res.status === 404) return say($('testResult'), t('pathNotFound'), false);
    say($('testResult'), t('reachable', res.status), true);
  } catch {
    say($('testResult'), t('cannotReach'), false);
  }
});

$('prepareTranslation').addEventListener('click', async () => {
  const out = $('translationResult');
  const language = $('language').value.trim();
  const target = $('translateTo').value;
  if (!target) return say(out, t('chooseTarget'), false);
  if ($('translationEngine').value === 'llm') return testLlm(out, language, target);
  if (!('Translator' in self)) return say(out, t('translatorUnavailableHere'), false);
  try {
    let pair = null;
    for (const source of [language, TRANSLATOR_SOURCE_FALLBACK[language]]) {
      if (!source || source === target) continue;
      if ((await Translator.availability({ sourceLanguage: source, targetLanguage: target })) !== 'unavailable') {
        pair = { sourceLanguage: source, targetLanguage: target };
        break;
      }
    }
    if (!pair) return say(out, t('cannotTranslatePair', language, target), false);
    say(out, t('preparing'), true);
    const translator = await Translator.create({
      ...pair,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => say(out, t('downloading', Math.round(e.loaded * 100)), true));
      },
    });
    const sample = await translator.translate('Dobar dan, kako ste?');
    translator.destroy();
    say(out, t('ready', pair.sourceLanguage, pair.targetLanguage, 'Dobar dan, kako ste?', sample), true);
  } catch (err) {
    say(out, t('failed', err.message), false);
  }
});

async function testLlm(out, language, target) {
  const config = { ...read(), language, translateTo: target };
  if (!isLocalUrl(config.llmUrl)) return say(out, t('notLocalUrl'), false);
  say(out, t('testing'), true);
  try {
    const sample = await translateWithLlm(config, { text: 'Dobar dan, kako ste?' });
    say(out, t('ready', language, target, 'Dobar dan, kako ste?', sample), true);
  } catch (err) {
    say(out, t('failed', err.message), false);
  }
}

localizePage();
for (const { code, label } of languageOptions(uiLocale())) $('language').add(new Option(label, code));
for (const { code, label } of translationOptions(uiLocale())) $('translateTo').add(new Option(label, code));
fill(await loadSettings());
syncScriptRow();
syncEngineRows();
$('language').addEventListener('change', syncScriptRow);
$('translationEngine').addEventListener('change', syncEngineRows);
