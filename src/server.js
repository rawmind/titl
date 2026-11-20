export const HOST_NAME = 'com.chrome_transcriber.host';
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

export async function ensureServer(serverUrl) {
  if (await isServerUp(serverUrl)) return;

  const { hostname, port: urlPort } = new URL(serverUrl);
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
    port.postMessage({ cmd: 'start', host: hostname, port: Number(urlPort) || 80 });
  });
  if (reply.status !== 'ready') throw new Error(reply.error ?? 'whisper-server failed to start');
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
  if (/not found/i.test(err)) {
    return 'whisper-server is not running and the auto-start helper is not installed (run `titl install`)';
  }
  return `Auto-start helper stopped: ${err || 'unknown error'}`;
}
