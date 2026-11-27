import { loadSettings, validateSettings } from './settings.js';
import { LookaheadSession } from './lookahead.js';
import { resolveServer } from './server.js';
import { translateWithLlm } from './llm.js';
import { AUTO } from './detect.js';
import { pushError } from './errors.js';

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

let errorWrites = Promise.resolve();

function recordError(source, error) {
  const message = error?.message ?? error;
  if (!message) return errorWrites;
  errorWrites = errorWrites
    .then(async () => {
      const { errors } = await chrome.storage.session.get('errors');
      await chrome.storage.session.set({ errors: pushError(errors, { source, message, at: Date.now() }) });
    })
    .catch(() => {});
  return errorWrites;
}

self.addEventListener('error', (e) => recordError('background', e.error ?? e.message));
self.addEventListener('unhandledrejection', (e) => recordError('background', e.reason));

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

async function announceLanguage(language) {
  const { tabId } = await setState({ language });
  return sendToTab(tabId, { type: 'language', language });
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

  await setState({ status: 'starting', language: null, timing: null });
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
      translationEngine: config.translationEngine,
      showOriginal: config.showOriginal,
      blurTranslation: config.blurTranslation,
      subtitleSize: config.subtitleSize,
    },
  });
  if (mode === 'lookahead') {
    lookahead = new LookaheadSession(tabId, config, {
      onLanguage: announceLanguage,
      onTiming: (timing) => setState({ timing }),
      onError: recordError,
    });
    await lookahead.start(info);
  } else {
    await startLive(tabId, config);
  }
  await setState({
    tabId,
    mode,
    scoutTabId: lookahead?.scoutTabId ?? null,
    serverUrl: config.serverUrl,
    ...(config.language === AUTO ? {} : { language: config.language }),
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
  await setState({ tabId: null, scoutTabId: null, mode: null, language: null, status: 'idle', lag: 0, delayed: false, error: null });
  await sendToTab(tabId, { type: 'overlay-stop' });
}

async function handle(msg, sender) {
  const fromTab = sender.tab?.id;
  switch (msg.type) {
    case 'start':
      return start(msg.tabId);
    case 'stop':
      return stop();
    case 'debug':
      return { lookahead: lookahead?.debugInfo() ?? null };
    case 'restart': {
      const { tabId, status } = await getState();
      if (status !== 'running' || tabId == null) return { restarted: false };
      await stop();
      await start(tabId);
      return { restarted: true };
    }

    case 'llm-translate': {
      const settings = await loadSettings();
      const language = msg.source ?? settings.language;
      return { translation: await translateWithLlm({ ...settings, language }, msg) };
    }

    case 'language':
      return announceLanguage(msg.language);

    case 'timing':
      await setState({ timing: msg.timing });
      return;

    case 'translate-to': {
      const { tabId, status } = await getState();
      if (status === 'running') await sendToTab(tabId, { type: 'translate-to', translateTo: msg.translateTo });
      return;
    }

    case 'caption': {
      const { tabId } = await getState();
      return sendToTab(tabId, { type: 'caption', text: msg.text, src: msg.src });
    }
    case 'status': {
      if (msg.error) recordError('live transcription', msg.error);
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
    case 'report-error':
      recordError(msg.source, msg.message);
      return;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'background') return;
  handle(msg, sender).then(
    (result) => sendResponse({ ok: true, ...result }),
    (err) => {
      recordError(msg.type, err);
      sendResponse({ ok: false, error: err.message });
    },
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
