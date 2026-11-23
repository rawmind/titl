import { test } from 'node:test';
import assert from 'node:assert/strict';

function listeners() {
  const list = new Set();
  return { addListener: (f) => list.add(f), removeListener: (f) => list.delete(f), emit: (m) => [...list].forEach((f) => f(m)) };
}

test('starting the helper sends the spoken language', async () => {
  const sent = [];
  const onMessage = listeners();
  globalThis.chrome = {
    runtime: {
      connectNative: () => ({
        onMessage,
        onDisconnect: listeners(),
        postMessage: (m) => {
          sent.push(m);
          queueMicrotask(() => onMessage.emit({ status: 'ready', port: 12345 }));
        },
      }),
    },
  };
  const { resolveServer } = await import('../src/server.js');
  const url = await resolveServer({ autoStartServer: true, language: 'sr', serverUrl: 'http://127.0.0.1:8080/inference' });
  assert.equal(url, 'http://127.0.0.1:12345/inference');
  assert.deepEqual(sent, [{ cmd: 'start', host: '127.0.0.1', language: 'sr' }]);
});
