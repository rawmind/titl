(() => {
  if (window.__chromeTranscriber?.alive()) return;
  window.__chromeTranscriber = { alive: () => Boolean(chrome.runtime?.id) };

  const LIVE_CLEAR_AFTER_MS = 6000;
  const LIVE_MAX_CHARS = 220;
  const CUE_HOLD_SEC = 0.6;
  const TICK_MS = 100;
  const REPORT_MS = 500;
  const TRANSLATOR_SOURCE_FALLBACK = { sr: 'hr', bs: 'hr' };
  const REVEAL_KEY = 'v';

  let root = null;
  let primaryEl = null;
  let secondaryEl = null;
  let badgeEl = null;
  let resizeObserver = null;
  let statusText = '';
  let translationNotice = '';

  let liveOriginal = '';
  let liveTranslation = '';
  let liveClearTimer = null;

  let mode = null;
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

  let revealed = false;
  let hintEl = null;

  let translator = null;
  let translateChain = Promise.resolve();
  let removeGestureListeners = null;

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
      const secondary = document.createElement('div');
      secondary.className = 'ct-secondary';
      secondaryEl = document.createElement('span');
      secondary.append(secondaryEl);
      const primary = document.createElement('div');
      primary.className = 'ct-primary';
      primaryEl = document.createElement('span');
      primary.append(primaryEl);
      primary.addEventListener('click', (e) => {
        if (!root?.classList.contains('ct-blurrable')) return;
        e.preventDefault();
        e.stopPropagation();
        toggleReveal();
      });
      for (const type of ['pointerdown', 'mousedown', 'dblclick']) {
        primary.addEventListener(type, (e) => {
          if (root?.classList.contains('ct-blurrable')) e.stopPropagation();
        });
      }
      hintEl = document.createElement('div');
      hintEl.className = 'ct-hint';
      box.append(secondary, primary, hintEl);
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

  function setText(primary, secondary = '', isTranslation = false) {
    if (!ensureOverlay()) return;
    if (primaryEl.textContent !== primary) primaryEl.textContent = primary;
    if (secondaryEl.textContent !== secondary) secondaryEl.textContent = secondary;
    root.classList.toggle('ct-visible', Boolean(primary || secondary));
    root.classList.toggle('ct-dual', Boolean(secondary));
    root.classList.toggle('ct-blurrable', Boolean(options?.blurTranslation && isTranslation && primary));
    applyReveal();
  }

  function applyReveal() {
    if (!root) return;
    const blurrable = root.classList.contains('ct-blurrable');
    root.classList.toggle('ct-blurred', blurrable && !revealed);
    hintEl.textContent = `${REVEAL_KEY.toUpperCase()} · ${revealed ? 'hide' : 'reveal'}`;
  }

  function toggleReveal() {
    if (!options?.blurTranslation) return false;
    revealed = !revealed;
    applyReveal();
    return true;
  }

  function isRevealKey(e) {
    const key = (e.key ?? '').toLowerCase();
    if (key === REVEAL_KEY) return true;
    return e.code === `Key${REVEAL_KEY.toUpperCase()}` && key.length === 1 && !/[a-z]/.test(key);
  }

  function onKeyDown(e) {
    if (!options?.blurTranslation || !isRevealKey(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const target = e.target;
    if (target?.isContentEditable || /^(input|textarea|select)$/i.test(target?.tagName ?? '')) return;
    if (toggleReveal()) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function updateBadge() {
    if (!ensureOverlay()) return;
    const text = waiting ? 'Preparing subtitles…' : translationNotice || statusText;
    if (badgeEl.textContent === text) return;
    badgeEl.textContent = text;
    badgeEl.classList.toggle('ct-visible', Boolean(text));
  }

  function showStatus({ lag, delayed, error }) {
    if (error) statusText = `⚠ ${error}`;
    else if (delayed) statusText = `Subtitles delayed ~${Math.round(lag)} s`;
    else statusText = '';
    updateBadge();
  }

  function setTranslationNotice(text) {
    translationNotice = text;
    updateBadge();
  }

  async function pickTranslatorPair(language, target) {
    for (const source of [language, TRANSLATOR_SOURCE_FALLBACK[language]]) {
      if (!source || source === target) continue;
      const pair = { sourceLanguage: source, targetLanguage: target };
      const availability = await Translator.availability(pair);
      if (availability !== 'unavailable') return { ...pair, availability };
    }
    return null;
  }

  async function setupTranslator() {
    const target = options.translateTo;
    if (!target) return;
    if (!('Translator' in self)) return setTranslationNotice('⚠ Translation needs Chrome 138 or newer');
    const pair = await pickTranslatorPair(options.language, target);
    if (!pair) return setTranslationNotice(`⚠ Chrome can't translate ${options.language} → ${target} on this device`);
    if (pair.availability === 'available') return createTranslator(pair);

    setTranslationNotice('Click the video once to download the translation model');
    const onGesture = () => {
      removeGestureListeners?.();
      createTranslator(pair);
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
    removeGestureListeners = () => {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      removeGestureListeners = null;
    };
  }

  async function createTranslator({ sourceLanguage, targetLanguage }) {
    const opts = options;
    try {
      setTranslationNotice('Preparing translation…');
      const created = await Translator.create({
        sourceLanguage,
        targetLanguage,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            setTranslationNotice(`Downloading translation model… ${Math.round(e.loaded * 100)}%`);
          });
        },
      });
      if (options !== opts) return created.destroy();
      translator = created;
      setTranslationNotice('');
      const t = getVideo()?.currentTime ?? 0;
      cues.filter((c) => c.end >= t - 5).forEach(translateCue);
    } catch (err) {
      if (options === opts) setTranslationNotice(`⚠ Translation unavailable: ${err.message}`);
    }
  }

  function translate(text) {
    const active = translator;
    const result = translateChain.then(() => active.translate(text));
    translateChain = result.catch(() => {});
    return result;
  }

  function translateCue(cue) {
    if (!translator || cue.translation != null) return;
    cue.translation = '';
    translate(cue.src ?? cue.text).then(
      (t) => (cue.translation = t),
      () => (cue.translation = null),
    );
  }

  function trimTail(text, max) {
    if (text.length <= max) return text;
    return text.slice(text.indexOf(' ', text.length - max) + 1);
  }

  function renderLive() {
    if (translator && liveTranslation) {
      setText(liveTranslation, options.showOriginal ? liveOriginal : '', true);
    } else {
      setText(liveOriginal);
    }
  }

  function showLiveCaption(text, src) {
    const max = translator && options.showOriginal ? LIVE_MAX_CHARS / 2 : LIVE_MAX_CHARS;
    liveOriginal = trimTail(`${liveOriginal} ${text}`.trim(), max);
    renderLive();
    if (translator) {
      translate(src ?? text).then(
        (t) => {
          liveTranslation = trimTail(`${liveTranslation} ${t}`.trim(), max);
          renderLive();
        },
        () => {},
      );
    }
    clearTimeout(liveClearTimer);
    liveClearTimer = setTimeout(() => {
      liveOriginal = liveTranslation = '';
      setText('');
    }, LIVE_CLEAR_AFTER_MS);
  }

  function renderCue(cue) {
    if (!cue) return setText('');
    if (translator && cue.translation) {
      return setText(cue.translation, options.showOriginal ? cue.text : '', true);
    }
    setText(cue.text);
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
      msg.cues.forEach(translateCue);
    }
    coverage = msg.coverage;
    maybeResume();
  }

  function pauseUntilReady(video) {
    if (!options.minLeadSec || video.paused || isAd()) return;
    if (coveredAhead(video.currentTime) >= options.minLeadSec) return;
    waiting = true;
    video.pause();
    updateBadge();
  }

  function maybeResume() {
    const video = getVideo();
    if (!waiting || !video || coveredAhead(video.currentTime) < options.minLeadSec) return;
    waiting = false;
    updateBadge();
    resumingByUs = true;
    video.play().catch(() => {});
  }

  function attachVideo(video) {
    attachedVideo = video;
    video.addEventListener('seeked', () => mode === 'lookahead' && pauseUntilReady(video));
    video.addEventListener('play', () => {
      if (mode !== 'lookahead') return;
      if (resumingByUs) {
        resumingByUs = false;
      } else if (waiting) {
        waiting = false;
        updateBadge();
      }
    });
    video.addEventListener('playing', () => {
      if (mode === 'lookahead' && checkOnPlay) {
        checkOnPlay = false;
        pauseUntilReady(video);
      }
    });
  }

  function sendToBackground(msg) {
    if (!chrome.runtime?.id) return stop();
    try {
      chrome.runtime.sendMessage({ target: 'background', ...msg }).catch(() => {});
    } catch {
      stop();
    }
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

    renderCue(isAd() ? null : cueAt(video.currentTime + options.showEarlySec));

    if (Date.now() - lastReport >= REPORT_MS) {
      lastReport = Date.now();
      sendToBackground({
        type: 'main-state',
        videoId,
        time: video.currentTime,
        paused: video.paused,
        rate: video.playbackRate,
        duration: video.duration,
        ad: isAd(),
      });
    }
  }

  function start(newMode, opts) {
    stop();
    mode = newMode;
    options = opts;
    revealed = false;
    window.addEventListener('keydown', onKeyDown, true);
    ensureOverlay();
    setupTranslator().catch((err) => setTranslationNotice(`⚠ Translation unavailable: ${err.message}`));
    if (mode !== 'lookahead') return;
    resetCues(getVideoId());
    timer = setInterval(tick, TICK_MS);
  }

  function stop() {
    window.removeEventListener('keydown', onKeyDown, true);
    clearInterval(timer);
    clearTimeout(liveClearTimer);
    removeGestureListeners?.();
    translator?.destroy();
    if (waiting) getVideo()?.play().catch(() => {});
    timer = options = mode = translator = null;
    waiting = false;
    liveOriginal = liveTranslation = statusText = translationNotice = '';
    resizeObserver?.disconnect();
    root?.remove();
    root = primaryEl = secondaryEl = badgeEl = hintEl = resizeObserver = null;
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
        if (options) showLiveCaption(msg.text, msg.src);
        break;
      case 'cues':
        if (mode === 'lookahead') onCues(msg);
        break;
      case 'status':
        showStatus(msg);
        break;
    }
  });
})();
