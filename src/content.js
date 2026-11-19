(() => {
  if (window.__chromeTranscriber) return;
  window.__chromeTranscriber = true;

  const LIVE_CLEAR_AFTER_MS = 6000;
  const LIVE_MAX_CHARS = 220;
  const CUE_HOLD_SEC = 0.6;
  const TICK_MS = 100;
  const REPORT_MS = 500;

  let root = null;
  let textEl = null;
  let badgeEl = null;
  let resizeObserver = null;
  let statusText = '';

  let liveBuffer = '';
  let liveClearTimer = null;

  let options = null;
  let timer = null;
  let cueVideoId = null;
  let cues = [];
  let coverage = [];
  let lastReport = 0;
  let attachedVideo = null;
  let waiting = false;
  let resumingByUs = false;
  let checkOnPlay = false;

  const findPlayer = () => document.querySelector('#movie_player') ?? document.querySelector('.html5-video-player');
  const getVideo = () => findPlayer()?.querySelector('video') ?? null;
  const isAd = () => Boolean(findPlayer()?.classList.contains('ad-showing'));

  function getVideoId() {
    const url = new URL(location.href);
    if (url.pathname === '/watch') return url.searchParams.get('v');
    return url.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/)?.[1] ?? null;
  }

  function isLive() {
    const badge = document.querySelector('.ytp-live-badge');
    return !Number.isFinite(getVideo()?.duration) || Boolean(badge && badge.offsetParent !== null);
  }

  function ensureOverlay() {
    const player = findPlayer();
    if (!player) return null;
    if (!root) {
      root = document.createElement('div');
      root.className = 'ct-overlay';
      const box = document.createElement('div');
      box.className = 'ct-text';
      textEl = document.createElement('span');
      box.append(textEl);
      badgeEl = document.createElement('div');
      badgeEl.className = 'ct-badge';
      root.append(badgeEl, box);
    }
    if (root.parentElement !== player) {
      player.append(root);
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(() => {
        const size = Math.max(14, Math.min(44, player.clientHeight * 0.045));
        root.style.setProperty('--ct-font-size', `${size}px`);
      });
      resizeObserver.observe(player);
    }
    return root;
  }

  function setText(text) {
    if (!ensureOverlay() || textEl.textContent === text) return;
    textEl.textContent = text;
    root.classList.toggle('ct-visible', Boolean(text));
  }

  function setBadge(text) {
    if (!ensureOverlay() || badgeEl.textContent === text) return;
    badgeEl.textContent = text;
    badgeEl.classList.toggle('ct-visible', Boolean(text));
  }

  function showStatus({ lag, delayed, error }) {
    if (error) statusText = `⚠ ${error}`;
    else if (delayed) statusText = `Subtitles delayed ~${Math.round(lag)} s`;
    else statusText = '';
    if (!waiting) setBadge(statusText);
  }

  function showLiveCaption(text) {
    liveBuffer = `${liveBuffer} ${text}`.trim();
    if (liveBuffer.length > LIVE_MAX_CHARS) {
      const cut = liveBuffer.indexOf(' ', liveBuffer.length - LIVE_MAX_CHARS);
      liveBuffer = liveBuffer.slice(cut + 1);
    }
    setText(liveBuffer);
    clearTimeout(liveClearTimer);
    liveClearTimer = setTimeout(() => {
      liveBuffer = '';
      setText('');
    }, LIVE_CLEAR_AFTER_MS);
  }

  function resetCues(videoId) {
    cueVideoId = videoId;
    cues = [];
    coverage = [];
    checkOnPlay = true;
  }

  function coveredAhead(t) {
    const range = coverage.find(([a, b]) => t >= a - 1 && t <= b);
    return range ? range[1] - t : -1;
  }

  function cueAt(t) {
    let lo = 0;
    let hi = cues.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return idx >= 0 && t < cues[idx].end + CUE_HOLD_SEC ? cues[idx] : null;
  }

  function onCues(msg) {
    if (msg.videoId !== cueVideoId) {
      if (msg.videoId !== getVideoId()) return;
      resetCues(msg.videoId);
    }
    if (msg.cues.length) {
      cues.push(...msg.cues);
      cues.sort((a, b) => a.start - b.start);
    }
    coverage = msg.coverage;
    maybeResume();
  }

  function pauseUntilReady(video) {
    if (!options.minLeadSec || video.paused || isAd()) return;
    if (coveredAhead(video.currentTime) >= options.minLeadSec) return;
    waiting = true;
    video.pause();
    setBadge('Preparing subtitles…');
  }

  function maybeResume() {
    const video = getVideo();
    if (!waiting || !video || coveredAhead(video.currentTime) < options.minLeadSec) return;
    waiting = false;
    setBadge(statusText);
    resumingByUs = true;
    video.play().catch(() => {});
  }

  function attachVideo(video) {
    attachedVideo = video;
    video.addEventListener('seeked', () => options && pauseUntilReady(video));
    video.addEventListener('play', () => {
      if (!options) return;
      if (resumingByUs) {
        resumingByUs = false;
      } else if (waiting) {
        waiting = false;
        setBadge(statusText);
      }
    });
    video.addEventListener('playing', () => {
      if (options && checkOnPlay) {
        checkOnPlay = false;
        pauseUntilReady(video);
      }
    });
  }

  function tick() {
    const video = getVideo();
    if (!video) return;
    if (video !== attachedVideo) attachVideo(video);
    const videoId = getVideoId();
    if (videoId !== cueVideoId) resetCues(videoId);
    if (checkOnPlay && !video.paused) {
      checkOnPlay = false;
      pauseUntilReady(video);
    }

    setText(isAd() ? '' : (cueAt(video.currentTime + options.showEarlySec)?.text ?? ''));

    if (Date.now() - lastReport >= REPORT_MS) {
      lastReport = Date.now();
      chrome.runtime
        .sendMessage({
          target: 'background',
          type: 'main-state',
          videoId,
          time: video.currentTime,
          paused: video.paused,
          rate: video.playbackRate,
          duration: video.duration,
          ad: isAd(),
        })
        .catch(() => {});
    }
  }

  function start(mode, opts) {
    stop();
    ensureOverlay();
    if (mode !== 'lookahead') return;
    options = opts;
    resetCues(getVideoId());
    timer = setInterval(tick, TICK_MS);
  }

  function stop() {
    clearInterval(timer);
    clearTimeout(liveClearTimer);
    if (waiting) getVideo()?.play().catch(() => {});
    timer = options = null;
    waiting = false;
    liveBuffer = statusText = '';
    resizeObserver?.disconnect();
    root?.remove();
    root = textEl = badgeEl = resizeObserver = null;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'ping':
        sendResponse({ ok: true });
        break;
      case 'info': {
        const video = getVideo();
        sendResponse({ videoId: getVideoId(), time: video?.currentTime ?? 0, live: isLive() });
        break;
      }
      case 'overlay-start':
        start(msg.mode, msg.options);
        break;
      case 'overlay-stop':
        stop();
        break;
      case 'caption':
        showLiveCaption(msg.text);
        break;
      case 'cues':
        if (options) onCues(msg);
        break;
      case 'status':
        showStatus(msg);
        break;
    }
  });
})();
