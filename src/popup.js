import { loadSettings } from './settings.js';

const $ = (id) => document.getElementById(id);

let running = false;

function render(state) {
  running = state?.status === 'running';
  $('toggle').textContent = running ? 'Stop subtitles' : 'Start subtitles';
  const status = $('status');
  status.classList.toggle('running', running && !state.error);
  if (state?.status === 'starting') status.textContent = 'Starting whisper-server…';
  else if (!running) status.textContent = 'Idle';
  else if (state.error) status.textContent = `Error: ${state.error}`;
  else if (state.delayed) status.textContent = `Running — delayed ~${Math.round(state.lag)} s`;
  else status.textContent = state.mode === 'lookahead' ? 'Running (lookahead)' : 'Running (live)';
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
      $('status').textContent = 'Open a YouTube video first.';
      return;
    }
    const res = await chrome.runtime.sendMessage({ target: 'background', type: 'start', tabId: tab.id });
    if (!res?.ok) $('status').textContent = `Error: ${res?.error ?? 'unknown'}`;
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
