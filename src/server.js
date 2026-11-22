export const HOST_NAME = 'com.chrome_transcriber.host';
export const HELPER_MISSING = 'helper-missing';
const START_TIMEOUT_MS = 120_000;

let port = null;

export async function isServerUp(serverUrl) {
  try {
    await fetch(serverUrl, { method: 'POST', body: new FormData(), signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

const LEGACY_HELPER_PORT = 8080;

export async function resolveServer(config) {
  if (config.autoStartServer) {
    try {
      return await startWithHelper();
    } catch (err) {
      if (await isServerUp(config.serverUrl)) return config.serverUrl;
      throw err;
    }
  }
  if (await isServerUp(config.serverUrl)) return config.serverUrl;
  throw new Error(`Cannot reach whisper-server at ${config.serverUrl}`);
}

async function startWithHelper() {
  port ??= connect();
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(reject, new Error('whisper-server did not start in time')), START_TIMEOUT_MS);
    const onMessage = (msg) => done(resolve, msg);
    const onDisconnect = () => done(reject, new Error(disconnectReason()));
    function done(fn, value) {
      clearTimeout(timer);
      port?.onMessage.removeListener(onMessage);
      port?.onDisconnect.removeListener(onDisconnect);
      fn(value);
    }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    port.postMessage({ cmd: 'start', host: '127.0.0.1' });
  });
  if (reply.status !== 'ready') throw new Error(reply.error ?? 'whisper-server failed to start');
  return serverUrlFor(reply.port ?? LEGACY_HELPER_PORT);
}

export function serverUrlFor(serverPort) {
  return `http://127.0.0.1:${serverPort}/inference`;
}

function connect() {
  const p = chrome.runtime.connectNative(HOST_NAME);
  p.onDisconnect.addListener(() => {
    if (port === p) port = null;
  });
  return p;
}

function disconnectReason() {
  const err = chrome.runtime.lastError?.message ?? '';
  if (/not found/i.test(err)) return HELPER_MISSING;
  return `Auto-start helper stopped: ${err || 'unknown error'}`;
}
