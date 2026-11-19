import { rms } from './audio.js';
import { Coverage } from './coverage.js';
import { SAMPLE_RATE, transcribe } from './whisper.js';
import { Transcript, applyScript, cleanText, splitCue } from './text.js';

// Segments ending this close to the window edge may be cut mid-word; they are
// re-transcribed at the start of the next window instead of being committed.
const TAIL_SEC = 1;

/**
 * Turns timestamped audio from the lookahead tab into cues on the video timeline.
 * Each window starts where the last committed segment ended, so windows do not
 * overlap and text dedup is only a safety net at the seams.
 */
export class LookaheadTranscriber {
  constructor(config, { transcribe, onCues, onError }) {
    this.config = config;
    this.transcribe = transcribe;
    this.onCues = onCues;
    this.onError = onError;
    this.reset();
  }

  reset() {
    this.blocks = [];
    this.commitT = null;
    this.final = false;
    this.transcript = new Transcript();
    this.gen = (this.gen ?? 0) + 1;
  }

  /** `t0` is the video time of the first sample; `rate` the playback rate it was played at. */
  addAudio({ t0, rate, samples }) {
    const t1 = t0 + (samples.length / SAMPLE_RATE) * rate;
    const last = this.blocks.at(-1);
    if (this.commitT === null || (last && (Math.abs(t0 - last.t1) > 0.3 || rate !== last.rate))) {
      this.reset();
      this.commitT = t0;
    }
    this.blocks.push({ t0, t1, rate, samples });
    this.final = false;
    this.pump();
  }

  /** The lookahead tab reached the end of the video: transcribe whatever is left. */
  finish() {
    if (this.final) return;
    this.final = true;
    this.pump();
  }

  async pump() {
    // Audio that arrives while a step is running sets `wake` so it is not missed.
    this.wake = true;
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.wake) {
        this.wake = false;
        while (await this.step());
      }
    } finally {
      this.busy = false;
    }
  }

  // Processes one window if enough audio is buffered. Returns true to keep going.
  async step() {
    const last = this.blocks.at(-1);
    if (!last) return false;
    const { rate } = last;
    const ws = this.commitT;
    const available = last.t1 - ws;
    const needed = this.config.lookaheadWindowSec * rate;
    if (available < (this.final ? 0.3 : needed)) return false;

    // Fall-behind handling: one bigger window rather than a queue of small ones.
    const we = ws + Math.min(available, this.config.maxWindowSec * rate);
    const isLast = this.final && we >= last.t1;
    const samples = this.extract(ws, we, rate);
    const gen = this.gen;

    if (rms(samples) < this.config.silenceRms) {
      this.commit(gen, ws, we, []);
      return true;
    }

    let segments;
    try {
      ({ segments = [] } = await this.transcribe(samples));
    } catch (err) {
      this.onError(err);
      return false; // Retried on the next audio block.
    }
    if (gen !== this.gen) return true;

    const winLen = we - ws;
    const toVideo = (s) => ({ start: ws + s.start * rate, end: ws + s.end * rate, text: s.text });
    let accepted = segments.filter((s) => s.end * rate <= winLen - TAIL_SEC);
    let commitT = ws + (accepted.at(-1)?.end ?? 0) * rate;
    if (isLast || !accepted.length || commitT - ws < 1) {
      accepted = segments;
      commitT = we;
    }

    const cues = [];
    for (const seg of accepted.map(toVideo)) {
      const scripted = this.config.language === 'sr' ? applyScript(seg.text, this.config.script) : seg.text;
      const text = this.transcript.append(cleanText(scripted));
      if (text) cues.push(...splitCue({ ...seg, text }));
    }
    this.commit(gen, ws, commitT, cues);
    return true;
  }

  commit(gen, from, to, cues) {
    if (gen !== this.gen) return;
    this.commitT = to;
    this.blocks = this.blocks.filter((b) => b.t1 > to);
    this.onCues(cues, from, to);
  }

  extract(ws, we, rate) {
    const out = new Float32Array(Math.round(((we - ws) / rate) * SAMPLE_RATE));
    for (const b of this.blocks) {
      const offset = Math.round(((b.t0 - ws) / rate) * SAMPLE_RATE);
      for (let i = Math.max(0, -offset); i < b.samples.length && offset + i < out.length; i++) {
        out[offset + i] = b.samples[i];
      }
    }
    return out;
  }
}

export function watchUrl(videoId, time) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0, Math.floor(time))}s`;
}

function decodeInt16Base64(data) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const pcm = new Int16Array(bytes.buffer);
  return Float32Array.from(pcm, (v) => v / 32768);
}

/**
 * Owns the hidden lookahead tab: keeps it playing ahead of the user's tab, feeds
 * its audio to the transcriber, and sends resulting cues to the user's tab.
 */
export class LookaheadSession {
  constructor(mainTabId, config) {
    this.mainTabId = mainTabId;
    this.config = config;
    this.scoutTabId = null;
    this.videoId = null;
    this.coverage = new Coverage();
    this.main = null;
    this.scout = null;
    this.holdUntil = 0;
    this.focusReturned = false;
    this.stopped = false;
    this.transcriber = new LookaheadTranscriber(config, {
      transcribe: (samples) => transcribe(config, samples, { verbose: true }),
      onCues: (cues, from, to) => this.emit(cues, from, to),
      onError: (err) => this.toMain({ type: 'status', error: err.message }),
    });
  }

  async start({ videoId, time }) {
    this.videoId = videoId;
    const main = await chrome.tabs.get(this.mainTabId);
    // Chrome defers media in tabs that were never shown, so open it in the foreground
    // and switch back once it plays.
    const tab = await chrome.tabs.create({
      url: watchUrl(videoId, time),
      windowId: main.windowId,
      index: main.index + 1,
      active: true,
    });
    this.scoutTabId = tab.id;
    await chrome.tabs.update(tab.id, { muted: true });
    setTimeout(() => this.returnFocus(), 8000);
  }

  stop() {
    this.stopped = true;
    if (this.scoutTabId != null) chrome.tabs.remove(this.scoutTabId).catch(() => {});
  }

  injectScout() {
    return chrome.scripting.executeScript({ target: { tabId: this.scoutTabId }, files: ['src/scout.js'] });
  }

  returnFocus() {
    if (this.focusReturned || this.stopped) return;
    this.focusReturned = true;
    chrome.tabs.update(this.mainTabId, { active: true }).catch(() => {});
  }

  toMain(msg) {
    return chrome.tabs.sendMessage(this.mainTabId, msg).catch(() => {});
  }

  command(cmd) {
    return chrome.tabs.sendMessage(this.scoutTabId, { type: 'scout-cmd', ...cmd }).catch(() => {});
  }

  hold(ms) {
    this.holdUntil = Date.now() + ms;
  }

  onScoutAudio(msg) {
    if (msg.videoId !== this.videoId) return;
    this.transcriber.addAudio({ t0: msg.t0, rate: msg.rate, samples: decodeInt16Base64(msg.data) });
  }

  onScoutState(state) {
    this.scout = state;
    if (!state.paused && !state.ad) this.returnFocus();
    if (state.ended && state.videoId === this.videoId) this.transcriber.finish();
    this.steer();
  }

  onMainState(state) {
    this.main = state;
    this.steer();
  }

  emit(cues, from, to) {
    this.coverage.add(from, to);
    this.toMain({ type: 'cues', videoId: this.videoId, cues, coverage: this.coverage.ranges });
    this.toMain({ type: 'status', error: null });
  }

  steer() {
    const { main, scout, config } = this;
    if (!main || !scout || this.stopped || main.ad) return;

    if (main.videoId && main.videoId !== this.videoId) {
      // User navigated to another video.
      this.videoId = main.videoId;
      this.coverage = new Coverage();
      this.transcriber.reset();
      chrome.tabs.update(this.scoutTabId, { url: watchUrl(main.videoId, main.time) }).catch(() => {});
      this.hold(5000);
      return;
    }
    if (Date.now() < this.holdUntil) return;

    // Where new transcription is needed: the end of what is covered around the playhead.
    const target = this.coverage.endAt(main.time) ?? main.time;
    const done = Number.isFinite(main.duration) && target >= main.duration - 1;

    if (scout.videoId !== this.videoId) {
      // YouTube autoplayed the next video in the lookahead tab, or it got lost.
      if (!done) {
        chrome.tabs.update(this.scoutTabId, { url: watchUrl(this.videoId, target) }).catch(() => {});
        this.hold(5000);
      }
      return;
    }
    if (scout.ad) return;

    const lead = target - main.time;
    const offset = scout.time - target;
    if (!done && (offset < -1 || offset > config.maxWindowSec * scout.rate + 10)) {
      this.transcriber.reset();
      this.command({ seek: target, play: true });
      this.hold(1500);
      return;
    }

    if (!scout.paused && (done || lead > config.maxLeadSec)) this.command({ pause: true });
    else if (scout.paused && !scout.ended && !done && lead < config.maxLeadSec - 10) this.command({ play: true });

    const rate = Math.max(1, main.rate);
    if (scout.rate !== rate) this.command({ rate });
  }
}
