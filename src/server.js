// Starts whisper-server on demand through the native messaging helper (native-host/).

export const HOST_NAME = 'com.local_whisper_subtitles.host';
const START_TIMEOUT_MS = 120_000;

let port = null;

/** True if something answers HTTP at the inference URL (any status counts). */
export async function isServerUp(serverUrl) {
  try {
    await fetch(serverUrl, { method: 'POST', body: new FormData(), signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes sure whisper-server answers at `serverUrl`, launching it via the helper if
 * needed. The helper owns the process and stops it when the connection closes. The
 * open connection also keeps this service worker alive, so in practice the server
 * runs until Chrome quits.
 */
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
    return 'whisper-server is not running and the auto-start helper is not installed (run native-host/install.sh)';
  }
  return `Auto-start helper stopped: ${err || 'unknown error'}`;
}
