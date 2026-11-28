import { describeErrors } from './errors.js';
import { AUTO, DEFAULTS, ENGINE, SERBIAN, TRANSLATOR_SOURCE_FALLBACK, isLocalUrl, loadSettings, validateSettings } from './settings.js';
import { languageOptions, translationOptions } from './languages.js';
import { localizePage, t, uiLocale } from './i18n.js';
import { translateWithLlm } from './llm.js';
import { HOST_NAME, isServerUp } from './server.js';
import { browserFromBrands, browserName, describeLookahead, describeTiming, estimateBackend, formatDebugInfo, modelFor, modelName, serbianOffer } from './debug.js';

const $ = (id) => document.getElementById(id);
const INSTALL_TIMEOUT_MS = 60_000;
const SAMPLE_TIMEOUT_MS = 10_000;
const TRANSLATOR_SETTING_UP = /Unable to create translator|service count exceeded/i;
const FIELDS = ['serverUrl', 'autoStartServer', 'mode', 'showEarlySec', 'minLeadSec', 'language', 'script', 'translateTo', 'translationEngine', 'llmUrl', 'llmModel', 'showOriginal', 'blurTranslation', 'subtitleSize', 'skipAds', 'windowSec', 'stepSec', 'maxWindowSec', 'lagThresholdSec'];

function fill(settings) {
  for (const f of FIELDS) {
    if ($(f).type === 'checkbox') $(f).checked = settings[f];
    else $(f).value = settings[f];
  }
}

function syncScriptRow() {
  $('scriptRow').hidden = $('language').value !== SERBIAN;
}

function syncEngineRows() {
  const engine = $('translationEngine').value;
  const llm = engine === ENGINE.LLM;
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
  slowDebugInfo = null;
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
  const button = $('prepareTranslation');
  if (button.disabled) return;
  button.disabled = true;
  try {
    await prepareTranslation();
  } finally {
    button.disabled = false;
  }
});

async function prepareTranslation() {
  const out = $('translationResult');
  const chosen = $('language').value.trim();
  const language = chosen === AUTO ? 'sr' : chosen;
  const target = $('translateTo').value;
  if (!target) return say(out, t('chooseTarget'), false);
  if ($('translationEngine').value === ENGINE.LLM) return testLlm(out, language, target);
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
    const stall = new AbortController();
    let stallTimer = null;
    let translator;
    try {
      translator = await Translator.create({
        ...pair,
        signal: stall.signal,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            if (e.loaded < 1) return say(out, t('downloading', Math.round(e.loaded * 100)), true);
            say(out, t('installingTranslation'), true);
            stallTimer ??= setTimeout(() => stall.abort(), INSTALL_TIMEOUT_MS);
          });
        },
      });
    } catch (err) {
      if (stall.signal.aborted) return say(out, t('translationStalled'), false);
      throw err;
    } finally {
      clearTimeout(stallTimer);
    }
    let sample;
    try {
      sample = await translator.translate('Dobar dan, kako ste?', { signal: AbortSignal.timeout(SAMPLE_TIMEOUT_MS) });
    } catch (err) {
      if (err.name === 'TimeoutError') return say(out, t('translationStalled'), false);
      throw err;
    } finally {
      translator.destroy();
    }
    say(out, t('ready', pair.sourceLanguage, pair.targetLanguage, 'Dobar dan, kako ste?', sample), true);
  } catch (err) {
    say(out, TRANSLATOR_SETTING_UP.test(err.message) ? t('translatorSettingUp') : t('failed', err.message), false);
  }
}

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
$('language').add(new Option(t('detectLanguage'), AUTO));
for (const { code, label } of languageOptions(uiLocale())) $('language').add(new Option(label, code));
for (const { code, label } of translationOptions(uiLocale())) $('translateTo').add(new Option(label, code));
fill(await loadSettings());
syncScriptRow();
syncEngineRows();
$('language').addEventListener('change', syncScriptRow);
$('language').addEventListener('change', syncSerbianOffer);
$('downloadSerbian').addEventListener('click', downloadSerbianModel);

let serbianHelper = null;
let serbianDownloading = false;

function syncSerbianOffer() {
  const model = modelFor(serbianHelper, $('language').value);
  $('modelInUse').hidden = !model;
  if (model) $('modelInUse').textContent = t('modelInUse', model);
  const { show } = serbianOffer(serbianHelper, $('language').value);
  $('serbianOffer').hidden = !show && !serbianDownloading;
  if (show && !serbianDownloading) $('downloadSerbian').hidden = false;
}

async function refreshSerbianOffer() {
  serbianHelper = await helperInfo();
  syncSerbianOffer();
}

async function downloadSerbianModel() {
  const button = $('downloadSerbian');
  const out = $('serbianResult');
  const language = $('language').value;
  button.disabled = true;
  serbianDownloading = true;
  say(out, t('downloadingSerbianModel'), true);
  try {
    const res = await chrome.runtime.sendNativeMessage(HOST_NAME, { cmd: 'downloadSerbianModel' });
    if (res?.status !== 'downloaded') throw new Error(res?.error ?? 'no answer');
    serbianHelper = { ...serbianHelper, serbian_model: res.path };
    button.hidden = true;
    syncSerbianOffer();
    await chrome.storage.local.set({ settings: { ...(await loadSettings()), language } });
    slowDebugInfo = null;
    const restart = await chrome.runtime.sendMessage({ target: 'background', type: 'restart' }).catch((err) => ({ ok: false, error: err.message }));
    if (restart?.restarted) say(out, t('serbianModelRestarted'), true);
    else if (restart && !restart.ok) say(out, t('serbianModelRestartFailed', restart.error), false);
    else say(out, t('serbianModelReady'), true);
  } catch (err) {
    say(out, t('serbianModelFailed', err.message), false);
  } finally {
    button.disabled = false;
    serbianDownloading = false;
  }
}

refreshSerbianOffer();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !serbianDownloading) refreshSerbianOffer();
});
$('translationEngine').addEventListener('change', syncEngineRows);

async function helperInfo() {
  try {
    const res = await chrome.runtime.sendNativeMessage(HOST_NAME, { cmd: 'info' });
    if (res?.status === 'info') return res;
    return { problem: res?.error === 'unknown command' ? 'helper is older than this feature: update it' : res?.error ?? 'no answer' };
  } catch (err) {
    return { problem: /not found/i.test(err.message) ? 'not installed' : err.message };
  }
}

async function translatorInfo(settings) {
  if (!('Translator' in self)) return 'not available in this browser';
  if (!settings.translateTo || settings.translationEngine !== ENGINE.CHROME) return 'not in use';
  const language = settings.language === AUTO ? 'sr' : settings.language;
  const results = [];
  for (const source of [language, TRANSLATOR_SOURCE_FALLBACK[language]]) {
    if (!source || source === settings.translateTo) continue;
    try {
      results.push(`${source} → ${settings.translateTo}: ${await Translator.availability({ sourceLanguage: source, targetLanguage: settings.translateTo })}`);
    } catch (err) {
      results.push(`${source} → ${settings.translateTo}: ${err.message}`);
    }
  }
  return results.join(', ');
}

async function browserVersion() {
  try {
    const { fullVersionList } = await navigator.userAgentData.getHighEntropyValues(['fullVersionList']);
    return browserFromBrands(fullVersionList) ?? browserName(navigator.userAgent);
  } catch {
    return browserName(navigator.userAgent);
  }
}

async function lookaheadInfo() {
  try {
    const res = await chrome.runtime.sendMessage({ target: 'background', type: 'debug' });
    return res?.lookahead ?? null;
  } catch {
    return null;
  }
}

async function serverAnswers(serverUrl) {
  if (!serverUrl) return null;
  return (await isServerUp(serverUrl)) ? 'yes' : 'no';
}

const SLOW_DEBUG_MS = 10_000;
let slowDebugInfo = null;
let slowDebugAt = 0;

async function collectDebugInfo() {
  const settings = await loadSettings();
  const manifest = chrome.runtime.getManifest();
  const platform = await chrome.runtime.getPlatformInfo();
  const { state, errors } = await chrome.storage.session.get(['state', 'errors']);
  if (Date.now() - slowDebugAt > SLOW_DEBUG_MS) slowDebugInfo = null;
  if (!slowDebugInfo) slowDebugAt = Date.now();
  slowDebugInfo ??= Promise.all([
    helperInfo(),
    translatorInfo(settings),
    browserVersion(),
    serverAnswers(state?.status === 'running' ? state.serverUrl : null),
  ]);
  const [[helper, translator, browser, answers], lookahead] = await Promise.all([slowDebugInfo, lookaheadInfo()]);
  const offer = serbianOffer(helper, $('language').value);
  return formatDebugInfo([
    ['Titl', [['version', manifest.version], ['extension id', chrome.runtime.id], ['interface language', uiLocale()]]],
    ['Browser', [['browser', browser], ['system', `${platform.os} ${platform.arch}`]]],
    ['Settings', [
      ['mode', settings.mode],
      ['spoken language', settings.language],
      ['Serbian script', settings.language === SERBIAN ? settings.script : null],
      ['translate to', settings.translateTo || 'off'],
      ['translator', settings.translationEngine],
      ['start whisper-server automatically', settings.autoStartServer],
      ['server URL', settings.autoStartServer ? null : settings.serverUrl],
    ]],
    ['Helper', [
      ['problem', helper.problem],
      ['version', helper.version],
      ['processor', helper.arch],
      ['helper build', helper.helper_arch && helper.helper_arch !== helper.arch ? `${helper.helper_arch} (emulated)` : null],
      ['runs on', helper.backend ?? (helper.version ? 'unknown (start subtitles once)' : estimateBackend(state?.timing))],
      ['threads', helper.threads],
      ['whisper-server', helper.server],
      ['model', helper.model],
      ['model for the spoken language', modelFor(helper, $('language').value)],
      ['model the server last loaded', modelName(helper.server_model)],
      ['Serbian model', offer.model],
      ['Serbian model offer', offer.reason],
      ['extra flags', helper.args?.join(' ')],
      ['setup problem', helper.config_error],
      ['log', helper.log],
    ]],
    ['Session', [
      ['status', state?.status ?? 'idle'],
      ['mode', state?.mode],
      ['server', state?.serverUrl],
      ['server answers', answers],
      ['detected language', settings.language === AUTO ? state?.language : null],
      ['last request', describeTiming(state?.timing)],
      ['short audio context', state?.timing ? (state.timing.shortContext ? 'on' : 'off') : null],
      ['error', state?.error],
    ]],
    ['Lookahead', describeLookahead(state, lookahead)],
    ["Chrome's translator", [['availability', translator]]],
    ['Last errors', describeErrors(errors)],
  ]);
}

let debugTimer = null;

async function showDebugInfo() {
  clearTimeout(debugTimer);
  if (!$('debug').open) {
    slowDebugInfo = null;
    return;
  }
  const pre = $('debugText');
  if (!pre.textContent) pre.textContent = '…';
  const text = await collectDebugInfo();
  if (pre.textContent !== text) {
    const scroll = pre.scrollTop;
    pre.textContent = text;
    pre.scrollTop = scroll;
  }
  debugTimer = setTimeout(showDebugInfo, 2000);
}

$('debug').addEventListener('toggle', showDebugInfo);
$('copyDebug').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('debugText').textContent);
  say($('copyResult'), t('copied'), true);
});
