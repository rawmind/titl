// Injected only into the hidden lookahead tab. Streams the <video> element's audio,
// stamped with video time, to the background, and obeys play/pause/seek commands.
(() => {
  if (window.__chromeTranscriberScout) return;
  window.__chromeTranscriberScout = true;

  const OUT_RATE = 16000;
  const BLOCK_SEC = 1;
  const STATE_MS = 500;

  let video = null;
  let stream = null;
  let reader = null;
  // Current continuous run: video time at its first sample and samples seen since.
  let run = null;
  let pending = [];
  let pendingFrames = 0;
  let pendingT0 = 0;
  let lastState = 0;
  let sendChain = Promise.resolve();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const findPlayer = () => document.querySelector('#movie_player') ?? document.querySelector('.html5-video-player');
  const isAd = () => Boolean(findPlayer()?.classList.contains('ad-showing'));
  const videoId = () => new URL(location.href).searchParams.get('v');

  function send(msg) {
    return chrome.runtime.sendMessage({ target: 'background', ...msg }).catch(() => {});
  }

  function reportState(force = false) {
    if (!force && Date.now() - lastState < STATE_MS) return;
    lastState = Date.now();
    const v = video ?? findPlayer()?.querySelector('video');
    send({
      type: 'scout-state',
      videoId: videoId(),
      time: v?.currentTime ?? 0,
      paused: v?.paused ?? true,
      ended: v?.ended ?? false,
      rate: v?.playbackRate ?? 1,
      ad: isAd(),
    });
  }

  function attach(v) {
    video = v;
    stream = v.captureStream();
    for (const ev of ['play', 'pause', 'seeked', 'ended', 'ratechange']) {
      v.addEventListener(ev, () => reportState(true));
    }
  }

  function dropRun() {
    run = null;
    pending = [];
    pendingFrames = 0;
  }

  async function encode(chunks, frames, sampleRate) {
    const ctx = new OfflineAudioContext(1, Math.max(1, Math.round((frames * OUT_RATE) / sampleRate)), OUT_RATE);
    const buf = ctx.createBuffer(1, frames, sampleRate);
    const data = buf.getChannelData(0);
    let o = 0;
    for (const c of chunks) {
      data.set(c, o);
      o += c.length;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    const out = (await ctx.startRendering()).getChannelData(0);
    const pcm = Int16Array.from(out, (s) => Math.max(-32768, Math.min(32767, Math.round(s * 32768))));
    const bytes = new Uint8Array(pcm.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function flush(sampleRate) {
    if (!pendingFrames) return;
    const chunks = pending;
    const frames = pendingFrames;
    const msg = { type: 'scout-audio', videoId: videoId(), t0: pendingT0, rate: run.rate };
    pending = [];
    pendingFrames = 0;
    pendingT0 = run.t0 + (run.frames / sampleRate) * run.rate;
    // Keep blocks in order even though encoding is async.
    sendChain = sendChain.then(async () => send({ ...msg, data: await encode(chunks, frames, sampleRate) }));
  }

  function handle(audio) {
    const { sampleRate, numberOfFrames: frames, numberOfChannels: channels } = audio;
    if (!video || video.seeking || isAd()) {
      audio.close();
      dropRun();
      return;
    }
    if (video.paused) {
      // Keep the run: after resuming, the timeline continues where it stopped.
      audio.close();
      return;
    }

    const mono = new Float32Array(frames);
    const plane = new Float32Array(frames);
    for (let ch = 0; ch < channels; ch++) {
      audio.copyTo(plane, { planeIndex: ch, format: 'f32-planar' });
      for (let i = 0; i < frames; i++) mono[i] += plane[i] / channels;
    }
    audio.close();

    const rate = video.playbackRate;
    const chunkT0 = video.currentTime - (frames / sampleRate) * rate;
    if (run) {
      // A seek or rate change breaks the timeline: send what we have and start over.
      const expected = run.t0 + (run.frames / sampleRate) * run.rate;
      if (Math.abs(chunkT0 - expected) > 0.5 || rate !== run.rate || sampleRate !== run.sampleRate) {
        flush(run.sampleRate);
        dropRun();
      }
    }
    if (!run) {
      run = { t0: chunkT0, frames: 0, rate, sampleRate };
      pendingT0 = chunkT0;
    }

    pending.push(mono);
    pendingFrames += frames;
    run.frames += frames;
    if (pendingFrames >= sampleRate * BLOCK_SEC) flush(sampleRate);
    reportState();
  }

  async function pump() {
    for (;;) {
      const v = findPlayer()?.querySelector('video');
      if (!v) {
        await sleep(500);
        continue;
      }
      if (v !== video) {
        attach(v);
        reader = null;
      }
      const track = stream.getAudioTracks().find((t) => t.readyState === 'live');
      if (!track) {
        // No audio yet, or YouTube swapped the source (ads, quality change).
        stream = v.captureStream();
        reader = null;
        await sleep(300);
        continue;
      }
      if (!reader) reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
      const { value, done } = await reader.read();
      if (done) {
        reader = null;
        dropRun();
        continue;
      }
      handle(value);
    }
  }

  function skipAd() {
    document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern')?.click();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== 'scout-cmd' || !video) return;
    if (msg.rate) video.playbackRate = msg.rate;
    if (msg.seek != null) {
      dropRun();
      video.currentTime = msg.seek;
    }
    if (msg.pause) video.pause();
    if (msg.play) video.play().catch(() => {});
  });

  // Fallback when no audio is flowing (paused, ad); throttled in background tabs.
  setInterval(() => {
    if (isAd()) skipAd();
    reportState();
  }, STATE_MS);

  pump();
})();
