import { loadSettings, validateSettings } from './settings.js';
import { LookaheadSession } from './lookahead.js';
import { resolveServer } from './server.js';

const OFFSCREEN_URL = 'src/offscreen.html';

let lookahead = null;

async function getState() {
  const { state } = await chrome.storage.session.get('state');
  return state ?? { tabId: null, status: 'idle' };
}

async function setState(patch) {
  const state = { ...(await getState()), ...patch };
  await chrome.storage.session.set({ state });
  return state;
}

function sendToTab(tabId, msg) {
  if (tabId == null) return Promise.resolve();
  return chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' });
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['src/content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
  }
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Capture tab audio and send it to the local whisper.cpp server',
  });
}

async function startLive(tabId, config) {
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, config });
  if (!res?.ok) throw new Error(res?.error ?? 'Failed to start audio capture');
}

async function start(tabId) {
  if ((await getState()).tabId != null) await stop();

  const config = await loadSettings();
  const invalid = validateSettings(config);
  if (invalid) throw new Error(invalid);

  await setState({ status: 'starting' });
  try {
    config.serverUrl = await resolveServer(config);
  } catch (err) {
    await setState({ status: 'idle' });
    throw err;
  }

  await ensureContentScript(tabId);
  const info = await chrome.tabs.sendMessage(tabId, { type: 'info' });
  const mode = config.mode === 'lookahead' && info?.videoId && !info.live ? 'lookahead' : 'live';

  await sendToTab(tabId, {
    type: 'overlay-start',
    mode,
    options: {
      showEarlySec: config.showEarlySec,
      minLeadSec: config.minLeadSec,
      language: config.language,
      translateTo: config.translateTo,
      showOriginal: config.showOriginal,
    },
  });
  if (mode === 'lookahead') {
    lookahead = new LookaheadSession(tabId, config);
    await lookahead.start(info);
  } else {
    await startLive(tabId, config);
  }
  await setState({
    tabId,
    mode,
    scoutTabId: lookahead?.scoutTabId ?? null,
    serverUrl: config.serverUrl,
    status: 'running',
    lag: 0,
    delayed: false,
    error: null,
  });
}

async function stop() {
  const { tabId, scoutTabId } = await getState();
  lookahead?.stop();
  lookahead = null;
  if (scoutTabId != null) await chrome.tabs.remove(scoutTabId).catch(() => {});

  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
    await chrome.offscreen.closeDocument().catch(() => {});
  }
  await setState({ tabId: null, scoutTabId: null, mode: null, status: 'idle', lag: 0, delayed: false, error: null });
  await sendToTab(tabId, { type: 'overlay-stop' });
}

async function handle(msg, sender) {
  const fromTab = sender.tab?.id;
  switch (msg.type) {
    case 'start':
      return start(msg.tabId);
    case 'stop':
      return stop();

    case 'caption': {
      const { tabId } = await getState();
      return sendToTab(tabId, { type: 'caption', text: msg.text, src: msg.src });
    }
    case 'status': {
      const { tabId } = await setState({ lag: msg.lag, delayed: msg.delayed, error: msg.error });
      return sendToTab(tabId, { type: 'status', lag: msg.lag, delayed: msg.delayed, error: msg.error });
    }

    case 'main-state':
      if (lookahead && fromTab === lookahead.mainTabId) lookahead.onMainState(msg);
      return;
    case 'scout-state':
      if (lookahead && fromTab === lookahead.scoutTabId) lookahead.onScoutState(msg);
      return;
    case 'scout-audio':
      if (lookahead && fromTab === lookahead.scoutTabId) lookahead.onScoutAudio(msg);
      return;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'background') return;
  handle(msg, sender).then(
    () => sendResponse({ ok: true }),
    (err) => sendResponse({ ok: false, error: err.message }),
  );
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (lookahead && tabId === lookahead.scoutTabId && change.status === 'complete') {
    lookahead.injectScout().catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { tabId: mainTabId, scoutTabId } = await getState();
  if (tabId === mainTabId || tabId === scoutTabId) await stop();
});

getState().then((state) => {
  if (state.status === 'running' && state.mode === 'lookahead' && !lookahead) stop();
});

async function closeStrayLookaheadTabs() {
  const groups = [
    ...(await chrome.tabGroups.query({ title: 'Titl' })),
    ...(await chrome.tabGroups.query({ title: 'Transcriber' })),
  ];
  for (const group of groups) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    await chrome.tabs.remove(tabs.map((t) => t.id)).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(() => closeStrayLookaheadTabs().catch(() => {}));
chrome.runtime.onStartup.addListener(() => closeStrayLookaheadTabs().catch(() => {}));
