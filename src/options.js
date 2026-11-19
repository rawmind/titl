import { DEFAULTS, isLocalUrl, loadSettings, validateSettings } from './settings.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['serverUrl', 'autoStartServer', 'mode', 'showEarlySec', 'minLeadSec', 'language', 'script', 'windowSec', 'stepSec', 'maxWindowSec', 'lagThresholdSec'];

function fill(settings) {
  for (const f of FIELDS) {
    if ($(f).type === 'checkbox') $(f).checked = settings[f];
    else $(f).value = settings[f];
  }
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
  say($('message'), 'Saved. Applies the next time subtitles are started.', true);
});

$('reset').addEventListener('click', async () => {
  await chrome.storage.local.remove('settings');
  fill(DEFAULTS);
  say($('message'), 'Defaults restored.', true);
});

$('test').addEventListener('click', async () => {
  const url = $('serverUrl').value.trim();
  if (!isLocalUrl(url)) return say($('testResult'), 'Not a local http URL', false);
  say($('testResult'), 'Testing…', true);
  try {
    // An empty POST is cheap and proves the endpoint exists; whisper-server answers
    // it with a "no file" error rather than running inference.
    const res = await fetch(url, { method: 'POST', body: new FormData(), signal: AbortSignal.timeout(5000) });
    if (res.status === 404) return say($('testResult'), 'Server is up, but this path returns 404', false);
    say($('testResult'), `Reachable (HTTP ${res.status})`, true);
  } catch {
    say($('testResult'), 'Cannot reach server', false);
  }
});

fill(await loadSettings());
