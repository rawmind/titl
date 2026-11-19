import { RingBuffer, rms } from './audio.js';
import { SAMPLE_RATE, transcribe } from './whisper.js';
import { Transcript, applyScript, cleanText } from './text.js';
import { isLocalUrl } from './settings.js';

const TICK_MS = 250;

let session = null;

function send(msg) {
  return chrome.runtime.sendMessage({ target: 'background', ...msg }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start') {
    start(msg.streamId, msg.config).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: err.message }),
    );
    return true;
  }
  if (msg.type === 'stop') {
    stop();
    sendResponse({ ok: true });
  }
});

async function start(streamId, config) {
  stop();
  if (!isLocalUrl(config.serverUrl)) throw new Error('Refusing non-local server URL');

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });

  const playback = new AudioContext();
  playback.createMediaStreamSource(stream).connect(playback.destination);

  const capture = new AudioContext({ sampleRate: SAMPLE_RATE });
  await capture.audioWorklet.addModule('capture-worklet.js');
  const worklet = new AudioWorkletNode(capture, 'pcm-capture', {
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  const sink = capture.createGain();
  sink.gain.value = 0;
  capture.createMediaStreamSource(stream).connect(worklet).connect(sink).connect(capture.destination);

  const ring = new RingBuffer(SAMPLE_RATE * (config.maxWindowSec + 4));
  worklet.port.onmessage = (e) => ring.push(e.data);

  stream.getAudioTracks()[0].addEventListener('ended', () => send({ type: 'stop' }));

  session = {
    config,
    stream,
    playback,
    capture,
    ring,
    transcript: new Transcript(),
    lastEnd: 0,
    busy: false,
    abort: null,
    timer: setInterval(tick, TICK_MS),
  };
}

function stop() {
  if (!session) return;
  const s = session;
  session = null;
  clearInterval(s.timer);
  s.abort?.abort();
  s.stream.getTracks().forEach((t) => t.stop());
  s.playback.close();
  s.capture.close();
}

function tick() {
  const s = session;
  if (!s || s.busy) return;
  const { config, ring } = s;
  const end = ring.total;
  const overlap = (config.windowSec - config.stepSec) * SAMPLE_RATE;
  let start = s.lastEnd === 0 ? 0 : s.lastEnd - overlap;
  if (end - start < config.windowSec * SAMPLE_RATE) return;

  const maxLen = config.maxWindowSec * SAMPLE_RATE;
  if (end - start > maxLen) {
    start = end - maxLen;
    s.transcript.reset();
  }
  s.lastEnd = end;

  const samples = ring.slice(start, end);
  if (rms(samples) < config.silenceRms) return;

  s.busy = true;
  const controller = new AbortController();
  s.abort = controller;
  transcribe(config, samples, { signal: controller.signal })
    .then(({ text: raw = '' }) => {
      if (session !== s) return;
      const scripted = config.language === 'sr' ? applyScript(raw, config.script) : raw;
      const text = s.transcript.append(cleanText(scripted));
      if (text) send({ type: 'caption', text });
      const lag = (ring.total - end) / SAMPLE_RATE;
      send({ type: 'status', lag, delayed: lag > config.lagThresholdSec, error: null });
    })
    .catch((err) => {
      if (session !== s) return;
      send({ type: 'status', lag: 0, delayed: false, error: err.message });
    })
    .finally(() => {
      if (session === s) {
        s.busy = false;
        s.abort = null;
      }
    });
}
