import { loadSettings } from './settings.js';

const $ = (id) => document.getElementById(id);

let running = false;

function render(state) {
  running = state?.status === 'running';
  $('toggleLabel').textContent = running ? 'Stop subtitles' : 'Start subtitles';
  $('toggle').classList.toggle('is-running', running);
  const status = $('status');
  status.classList.toggle('running', running && !state.error);
  status.classList.toggle('error', Boolean(running && state.error));
  let text;
  if (state?.status === 'starting') text = 'Starting whisper-server…';
  else if (!running) text = 'Idle';
  else if (state.error) text = `Error: ${state.error}`;
  else if (state.delayed) text = `Running — delayed ~${Math.round(state.lag)} s`;
  else text = state.mode === 'lookahead' ? 'Running (lookahead)' : 'Running (live)';
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
      showError('Open a YouTube video first.');
      return;
    }
    const res = await chrome.runtime.sendMessage({ target: 'background', type: 'start', tabId: tab.id });
    if (!res?.ok) showError(`Error: ${res?.error ?? 'unknown'}`);
  } finally {
    $('toggle').disabled = false;
  }
}

$('toggle').addEventListener('click', toggle);
$('options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

const { serverUrl, language } = await loadSettings();
$('server').textContent = `${new URL(serverUrl).host} · ${language}`;
$('server').title = serverUrl;

render((await chrome.storage.session.get('state')).state);
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.state) render(changes.state.newValue);
});
