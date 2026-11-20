import { loadSettings } from './settings.js';
import { languageName } from './languages.js';
import { localizePage, t, uiLocale } from './i18n.js';
import { HOST_NAME } from './server.js';

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
    if (!res?.ok) showError(t('errorPrefix', res?.error ?? 'unknown'));
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

function renderServer(state) {
  const url = state?.status === 'running' && state.serverUrl ? state.serverUrl : null;
  const where = url ? new URL(url).host : settings.autoStartServer ? t('autoStartLabel') : new URL(settings.serverUrl).host;
  $('server').textContent = `${where} · ${languageName(settings.language, uiLocale())}`;
  $('server').title = url ?? settings.serverUrl;
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

$('updateButton').addEventListener('click', updateHelper);
checkHelperUpdate();

const initial = (await chrome.storage.session.get('state')).state;
render(initial);
renderServer(initial);
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.state) {
    render(changes.state.newValue);
    renderServer(changes.state.newValue);
  }
});
