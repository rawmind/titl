# Chrome Transcriber

Chrome extension that shows subtitles on any YouTube video, transcribed on your own Mac by [whisper.cpp](https://github.com/ggml-org/whisper.cpp). It's built for Serbian and works with any language Whisper supports. Audio never leaves your machine: it only goes to `127.0.0.1`.

## Features

- **Subtitles on time.** A hidden, muted copy of the video plays a few seconds ahead and gets transcribed first, so each line appears as it is spoken (or slightly before).
- **Live mode** for live streams, or if you prefer it: transcribes what is playing, with subtitles 3–5 s late.
- **Local, GPU-accelerated:** `whisper-server` with `large-v3-turbo` on Metal, about 0.8 s per 8 s of audio on Apple Silicon.
- **Starts the server for you:** the first Start launches `whisper-server`, and it keeps running until Chrome quits.
- **Serbian script control:** output is always Latin or always Cyrillic, never a mix.
- Works in normal and fullscreen mode, doesn't block YouTube controls, and follows seeks, speed changes and navigation to other videos.

## Requirements

- macOS on Apple Silicon, Chrome 116+ (Chromium works too)
- whisper.cpp built locally, plus a Whisper model (recommended: `ggml-large-v3-turbo.bin`, 1.6 GB)
- Python 3 (used by the auto-start helper)

## Install

**1. Build whisper.cpp and download the model** (skip if you already have them):

```bash
git clone https://github.com/ggml-org/whisper.cpp ~/projects/whisper.cpp
cd ~/projects/whisper.cpp
cmake -B build && cmake --build build -j --config Release   # Metal is enabled by default on macOS
./models/download-ggml-model.sh large-v3-turbo
```

**2. Register the auto-start helper** (one time, and again if you move either folder):

```bash
native-host/install.sh                                     # uses ~/projects/whisper.cpp
native-host/install.sh /path/to/whisper.cpp /path/to/model.bin
```

**3. Load the extension:** go to `chrome://extensions`, turn on Developer mode, click **Load unpacked** and select this folder.

The manifest fixes the extension ID at `fehpgpahkmanekioejihbpihpbacdjgb`, and the helper only accepts requests from that ID.

## Usage

1. Open a YouTube video.
2. Click the extension icon, then **Start subtitles**.
3. In lookahead mode:
   - A muted tab opens next to yours for a moment (Chrome only plays media in a tab that has been shown), then focus returns to your tab.
   - Your video pauses briefly while "Preparing subtitles…" is shown, about 12 s on first start, then plays with subtitles.
   - Press play at any time to skip the wait.
4. To finish, click **Stop subtitles**. The extension also stops by itself when you close either tab.

The first Start after launching Chrome waits about 4 s for the model to load. If you started `whisper-server` yourself, the extension uses it and never stops it.

## Settings

Open them from the popup's **Settings** link, or right-click the icon and choose **Options**.

| Setting | Default | Notes |
|---|---|---|
| Inference URL | `http://127.0.0.1:8080/inference` | Must be `127.0.0.1` or `localhost`, any port. **Test connection** checks it. |
| Start whisper-server automatically | on | Needs the helper from step 2 of Install. |
| Mode | Lookahead | Live streams always use live mode. |
| Show early by | 0.3 s | Lookahead: how far before its timestamp a line appears. |
| Pause until ready | 3 s | Lookahead: pause until this much is transcribed ahead. 0 never pauses. |
| Language | `sr` | Any Whisper language code. |
| Serbian script | Latin | Latin, Cyrillic, or as returned (may mix). Only used for `sr`. |
| Live window / step | 6 s / 4 s | Live mode chunking (2 s overlap). |
| Max window | 12 s | Largest chunk when transcription falls behind. |
| Lag warning threshold | 10 s | Live mode: show "delayed" past this. |

To pass extra flags to `whisper-server` (e.g. threads), add them to `"args"` in `native-host/config.json`.

## Languages

Set any language Whisper supports (`en`, `ru`, `de`, `hr`, …). A few parts are tuned for Serbian:

- Script conversion only applies to `sr`.
- The filter for phrases Whisper tends to invent (e.g. "Hvala na pažnji" over music) only lists Serbian phrases.
- In live mode, duplicate removal splits words on spaces, so it works poorly for Chinese or Japanese. Lookahead mode doesn't depend on it.

Automatic language detection isn't supported yet.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "auto-start helper is not installed" | Run `native-host/install.sh`, then try again. |
| "whisper-server exited…" or "did not start" | Check `~/Library/Logs/chrome-transcriber.log`. Usually a wrong model path: re-run `install.sh` with the right paths. |
| "Cannot reach whisper-server" | The server URL or port is wrong, or auto-start is off. Use **Test connection** in Options. |
| Stuck on "Preparing subtitles…" | Look at the hidden tab: it may be showing an ad, a consent page or a sign-in prompt. Fix it there, or switch to live mode. |
| Subtitles appear in the wrong script | Options → Serbian script. |
| Nothing happens after moving the folder | Re-run `native-host/install.sh`, then remove and re-load the unpacked extension. |

To remove the helper, run `native-host/uninstall.sh`.

## How it works

### Lookahead mode

```
your tab ── main-state (time, paused, rate) ──▶ background ◀── scout-state / scout-audio ── hidden muted tab
   ▲                                                │                                         (same video, ahead)
   └──────── cues on the video timeline ────────────┘── POST /inference (verbose_json)
```

- The hidden tab's audio comes from `video.captureStream()` and is stamped with video time.
- Audio is cut into 8 s windows that don't overlap. Each window starts where the last *complete* Whisper segment ended. A segment within 1 s of the window edge may be cut mid-word, so it is redone in the next window.
- Segment timestamps place each cue at an exact video time. Your tab shows the cue at `currentTime + showEarlySec`.
- The hidden tab follows seeks, video changes and playback rate. It pauses once it is 45 s ahead and clicks "Skip ad" when it can.
- Cost: the video streams twice.

### Live mode

```
popup → background (tabCapture stream id) → offscreen document
  getUserMedia(tab) ─┬─ AudioContext → speakers (tab keeps playing)
                     └─ AudioContext @16 kHz → AudioWorklet → ring buffer
  every step: WAV window (16 kHz mono s16) → POST /inference → dedup → overlay
```

- Windows overlap by 2 s. Text deduplication (longest suffix/prefix token match, ignoring case, punctuation, diacritics and script) removes the repeated words.
- One request runs at a time and audio sits in a fixed-size buffer. When transcription falls behind, the next window grows instead of requests queuing up, so memory stays bounded.

### Auto-start helper

Chrome extensions can't run native programs, so `native-host/host.py` is registered as a Chrome [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) host. On Start, the extension asks it to launch `whisper-server`. The server stops when that connection closes, which in practice means when Chrome quits.

## Project layout

```
manifest.json
src/
  background.js      service worker: start/stop, routing, server auto-start
  lookahead.js       hidden-tab control and timeline transcription
  scout.js           runs in the hidden tab: audio capture, play/seek commands
  content.js/.css    runs in your tab: subtitle overlay, sync, pause-until-ready
  offscreen.js       live mode: tab capture and chunked transcription
  capture-worklet.js live mode: PCM capture at 16 kHz
  whisper.js         whisper-server client
  text.js            dedup, Serbian transliteration, cleanup, cue splitting
  audio.js           ring buffer, RMS, WAV encoding
  coverage.js        transcribed time ranges
  settings.js        defaults and validation
  popup.*, options.* UI
native-host/
  host.py            native messaging host that runs whisper-server
  install.sh         registers the host (writes config.json and run-host.sh)
  uninstall.sh
tests/               node:test unit tests
```

## Development

```bash
npm test     # no dependencies to install; needs Node 20+
```

After editing, reload the extension in `chrome://extensions`. If you changed `content.js`, also reload the YouTube tab.

## License

MIT, see [LICENSE](LICENSE). Bundling whisper.cpp or a Whisper model (both MIT) means including their license notices.
