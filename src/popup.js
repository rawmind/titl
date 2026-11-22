import { loadSettings } from './settings.js';
import { languageName, translationOptions } from './languages.js';
import { localizePage, t, uiLocale } from './i18n.js';
import { HELPER_MISSING, HOST_NAME } from './server.js';
import { installUrl } from './site.js';

localizePage();

const $ = (id) => document.getElementById(id);

let running = false;

function render(state) {
  running = state?.status === 'running';
  $('toggleLabel').textContent = t(running ? 'stopSubtitles' : 'startSubtitles');
  $('toggle').classList.toggle('is-running', running);
  const status = $('status');
  status.classList.toggle('running', running && !state.error);
  status.classList.toggle('error', Boolean(running && state.error));
  let text;
  if (state?.status === 'starting') text = t('starting');
  else if (!running) text = t('idle');
  else if (state.error) text = t('errorPrefix', state.error);
  else if (state.delayed) text = t('runningDelayed', Math.round(state.lag));
  else text = t(state.mode === 'lookahead' ? 'runningLookahead' : 'runningLive');
  $('statusText').textContent = text;
}

function showError(text) {
  $('status').classList.add('error');
  $('statusText').textContent = text;
}

async function showHelperMissing() {
  $('status').classList.add('error');
  const { os } = await chrome.runtime.getPlatformInfo();
  const link = Object.assign(document.createElement('a'), {
    href: installUrl(chrome.runtime.getManifest().homepage_url, uiLocale(), os),
    textContent: t('downloadHelper'),
  });
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: link.href });
  });
  $('statusText').replaceChildren(`${t('helperMissing')} `, link);
}

async function toggle() {
  $('toggle').disabled = true;
  try {
    if (running) {
      await chrome.runtime.sendMessage({ target: 'background', type: 'stop' });
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith('https://www.youtube.com/')) {
      showError(t('openYouTubeFirst'));
      return;
    }
    const res = await chrome.runtime.sendMessage({ target: 'background', type: 'start', tabId: tab.id });
    if (res?.error === HELPER_MISSING) await showHelperMissing();
    else if (!res?.ok) showError(t('errorPrefix', res?.error ?? 'unknown'));
  } finally {
    $('toggle').disabled = false;
  }
}

$('toggle').addEventListener('click', toggle);
$('options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

const settings = await loadSettings();

function spokenLanguage(state) {
  if (settings.language !== 'auto') return languageName(settings.language, uiLocale());
  const detected = state?.status === 'running' ? state.language : null;
  return detected ? t('detectedLanguage', languageName(detected, uiLocale())) : t('detectLanguage');
}

function renderLanguages(state) {
  $('spoken').textContent = spokenLanguage(state);
}

async function checkHelperUpdate() {
  if (!settings.autoStartServer) return;
  let res;
  try {
    res = await chrome.runtime.sendNativeMessage(HOST_NAME, { cmd: 'checkUpdate' });
  } catch {
    return;
  }
  if (res?.status !== 'update') return;
  $('updateText').textContent = t('helperUpdateAvailable', res.latest);
  $('updateNotes').replaceChildren(
    ...(res.notes ?? []).map((note) => Object.assign(document.createElement('li'), { textContent: note })),
  );
  $('updateNotesLink').href = res.url;
  $('update').hidden = false;
}

async function updateHelper() {
  const button = $('updateButton');
  button.disabled = true;
  $('updateText').textContent = t('updatingHelper');
  try {
    const res = await chrome.runtime.sendNativeMessage(HOST_NAME, { cmd: 'update' });
    if (res?.status !== 'updated') throw new Error(res?.error ?? 'unknown');
    $('updateText').textContent = t('helperUpdated', res.version);
    $('updateNotes').replaceChildren();
    button.hidden = true;
  } catch (err) {
    $('updateText').textContent = t('helperUpdateFailed', err.message);
    button.disabled = false;
  }
}

async function changeTranslateTo() {
  const translateTo = $('target').value;
  const stored = await loadSettings();
  await chrome.storage.local.set({ settings: { ...stored, translateTo } });
  settings.translateTo = translateTo;
  await chrome.runtime.sendMessage({ target: 'background', type: 'translate-to', translateTo }).catch(() => {});
}

for (const { code, name } of translationOptions(uiLocale())) $('target').add(new Option(name, code));
$('target').value = settings.translateTo;
$('target').addEventListener('change', changeTranslateTo);

$('updateButton').addEventListener('click', updateHelper);
checkHelperUpdate();

const initial = (await chrome.storage.session.get('state')).state;
render(initial);
renderLanguages(initial);
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.state) {
    render(changes.state.newValue);
    renderLanguages(changes.state.newValue);
  }
});
