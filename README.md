# Titl

<img src="icons/icon128.png" width="64" align="right" alt="">

**Titl** (this repo: `chrome-transcriber`) is a Chrome extension that shows subtitles on any YouTube video, transcribed on your own Mac by [whisper.cpp](https://github.com/ggml-org/whisper.cpp). It's built for Serbian and works with any language Whisper supports. Audio never leaves your machine: it only goes to `127.0.0.1`.

## Features

- **Subtitles on time.** A hidden, muted copy of the video plays a few seconds ahead and gets transcribed first, so each line appears as it is spoken (or slightly before).
- **Live mode** for live streams, or if you prefer it: transcribes what is playing, with subtitles 3–5 s late.
- **Local, GPU-accelerated:** `whisper-server` with `large-v3-turbo` on Metal, about 0.8 s per 8 s of audio on Apple Silicon.
- **Starts the server for you:** the first Start launches `whisper-server`, and it keeps running until Chrome quits.
- **Cross-platform helper:** one Rust binary installs and runs everything on macOS, Linux and Windows, and downloads a model if needed.
- **Serbian script control:** output is always Latin or always Cyrillic, never a mix.
- **On-device translation** into English, Russian, German and more, using Chrome's built-in translator. The original can be shown above the translation.
- Works in normal and fullscreen mode, doesn't block YouTube controls, and follows seeks, speed changes and navigation to other videos.

## Requirements

- Chrome 116+, or Chromium, Edge or Brave, on macOS, Linux or Windows
- whisper.cpp's `whisper-server` (Homebrew or your own build). GPU strongly recommended: Metal, Vulkan or CUDA
- A Whisper model: the helper downloads one if you don't have it

## Install

### macOS with Homebrew

```bash
brew install rawmind/tap/chrome-transcriber   # also installs whisper-cpp
chrome-transcriber-helper install
```

`install` ends by showing how to add the extension to Chrome: it puts the folder path on your clipboard and reveals it in Finder. Chrome only adds extensions from the Chrome Web Store automatically, so this one is loaded once by hand (step 3 below). The folder is `$(brew --prefix)/opt/chrome-transcriber/share/chrome-transcriber/extension`.

### Any platform from source

**1. Get whisper.cpp:** `brew install whisper-cpp` on macOS, or build it ([instructions](https://github.com/ggml-org/whisper.cpp#quick-start)). Use Metal on macOS, and Vulkan or CUDA on Windows and Linux for GPU speed.

**2. Build and run the helper** (needs [Rust](https://rustup.rs)):

```bash
cargo build --release --manifest-path helper/Cargo.toml
helper/target/release/chrome-transcriber-helper install
```

`install` does the rest:
- finds `whisper-server` on `PATH` or in common whisper.cpp build folders;
- finds a model next to it, or downloads `large-v3-turbo-q5_0` (about 550 MB);
- copies itself to a per-user folder;
- registers itself with Chrome, Chromium, Edge and Brave (on Windows, through the registry).

To choose explicitly, use `--server PATH`, `--model PATH` or `--download-model NAME` (e.g. `large-v3-turbo` for the full-precision 1.6 GB model).

**3. Load the extension:** go to `chrome://extensions`, turn on Developer mode, click **Load unpacked** and select this folder.

The manifest fixes the extension ID at `fehpgpahkmanekioejihbpihpbacdjgb`, and the helper only accepts requests from that ID.

### Helper commands

| Command | |
|---|---|
| `chrome-transcriber-helper status` | Show the server, model, which browsers it's registered with, and whether the extension is loaded |
| `chrome-transcriber-helper install …` | (Re)install; run again after moving whisper.cpp or a model |
| `chrome-transcriber-helper uninstall [--purge]` | Unregister; `--purge` also deletes downloaded models |

Per-user files (config, downloaded models, `server.log`) live in:
- macOS: `~/Library/Application Support/chrome-transcriber/`
- Linux: `~/.local/share/chrome-transcriber/`
- Windows: `%LOCALAPPDATA%\chrome-transcriber\`

## Usage

1. Open a YouTube video.
2. Click the extension icon, then **Start subtitles**.
3. In lookahead mode:
   - A muted tab opens next to yours for a moment (Chrome only plays media in a tab that has been shown). Then focus returns to your tab and the muted tab is tucked into a collapsed grey **Titl** tab group. Click the group to look at it, e.g. if it is stuck on an ad.
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
| Translate to | Off | Target language for Chrome's on-device translator. |
| Show the original above the translation | on | Two-line display: original small on top, translation below. |
| Skip ads in the hidden tab | off | Lookahead: click YouTube's "Skip ad" in the muted tab when offered. Otherwise it waits the ad out. |
| Live window / step | 6 s / 4 s | Live mode chunking (2 s overlap). |
| Max window | 12 s | Largest chunk when transcription falls behind. |
| Lag warning threshold | 10 s | Live mode: show "delayed" past this. |

To pass extra flags to `whisper-server` (e.g. threads), add them to `"args"` in the helper's `config.json` (see `chrome-transcriber-helper status`).

## Translation

Choose **Options → Translate to**, then click **Download translation model** once. It downloads the language pack (one time, kept by Chrome) and shows a sample translation. If you skip this, the first click on the YouTube page during playback starts the download instead.

- Everything runs on this device through Chrome's [Translator API](https://developer.chrome.com/docs/ai/translator-api) (Chrome 138+).
- Chrome has no Serbian translation model, so Serbian is translated as Croatian. The text is always sent as Latin script, even when subtitles are shown in Cyrillic. Expect occasional word-choice slips where the two languages' vocabularies differ.
- In lookahead mode, translation happens seconds before a line is shown, so it adds no delay. In live mode it adds a fraction of a second.
- Whisper's own translation isn't used: `large-v3-turbo` was trained without translation data, and Whisper can only translate into English.

## Languages

Set any language Whisper supports (`en`, `ru`, `de`, `hr`, …). A few parts are tuned for Serbian:

- Script conversion only applies to `sr`.
- The filter for phrases Whisper tends to invent (e.g. "Hvala na pažnji" over music) only lists Serbian phrases.
- In live mode, duplicate removal splits words on spaces, so it works poorly for Chinese or Japanese. Lookahead mode doesn't depend on it.

Automatic language detection isn't supported yet.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Extension doesn't appear in Chrome after `install` | `install` doesn't add it: load it once via **Load unpacked** (Install, step 3). `chrome-transcriber-helper status` shows whether Chrome has it. |
| "auto-start helper is not installed" | Run `chrome-transcriber-helper install`, then try again. |
| "whisper-server exited…" or "did not start" | Check `server.log` in the helper's folder. Run `chrome-transcriber-helper status`: a path marked "(missing!)" means re-run `install`. |
| "Cannot reach whisper-server" | The server URL or port is wrong, or auto-start is off. Use **Test connection** in Options. |
| Stuck on "Preparing subtitles…" | Expand the **Titl** tab group and look at the hidden tab: it may be showing an ad, a consent page or a sign-in prompt. Fix it there, or switch to live mode. |
| Subtitles appear in the wrong script | Options → Serbian script. |
| Translation doesn't appear | The language pack may not be downloaded yet. Use **Download translation model** in Options, or click the YouTube page once while subtitles are on. |
| "Click the video once to download the translation model" | Click anywhere on the YouTube page, or use **Download translation model** in Options. |
| "Chrome can't translate … on this device" | That language pair isn't offered by Chrome's translator. Pick another target. |
| Nothing happens after moving the extension folder | Remove and re-load the unpacked extension. |

To remove the helper, run `chrome-transcriber-helper uninstall`.

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
- The hidden tab follows seeks, video changes and playback rate. It pauses once it is 45 s ahead and, if enabled in Options, clicks "Skip ad".
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

Chrome extensions can't run native programs, so `chrome-transcriber-helper` (Rust, in `helper/`) is registered as a Chrome [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) host. On Start, the extension asks it to launch `whisper-server`. The server stops when that connection closes, which in practice means when Chrome quits.

## Project layout

```
manifest.json
src/
  background.js      service worker: start/stop, routing, server auto-start
  lookahead.js       hidden-tab control and timeline transcription
  scout.js           runs in the hidden tab: audio capture, play/seek commands
  content.js/.css    runs in your tab: subtitle overlay, translation, sync, pause-until-ready
  offscreen.js       live mode: tab capture and chunked transcription
  capture-worklet.js live mode: PCM capture at 16 kHz
  whisper.js         whisper-server client
  text.js            dedup, Serbian transliteration, cleanup, cue splitting
  audio.js           ring buffer, RMS, WAV encoding
  coverage.js        transcribed time ranges
  settings.js        defaults and validation
  popup.*, options.* UI
helper/              Rust: installer and native messaging host
  src/install.rs     find server/model, self-copy, browser registration
  src/extension.rs   locate the extension folder, detect it in browser profiles
  src/host.rs        native messaging protocol, whisper-server process
  src/model.rs       model download from Hugging Face
  src/paths.rs       per-OS folders and browser registration locations
icons/               extension icons (SVG sources and PNGs)
store/               Chrome Web Store listing text and promo images
scripts/package.mjs  builds the store zip
tests/               node:test unit tests
```

## Development

```bash
npm test                                         # extension; no dependencies, Node 20+
cargo test --manifest-path helper/Cargo.toml     # helper
npm run package                                  # Chrome Web Store zip in dist/ (manifest key removed)
```

After editing, reload the extension in `chrome://extensions`. If you changed `content.js`, also reload the YouTube tab.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) and [Releases](https://github.com/rawmind/chrome-transcriber/releases).

## Privacy

Nothing leaves your computer. See [PRIVACY.md](PRIVACY.md).

## License

MIT, see [LICENSE](LICENSE). Bundling whisper.cpp or a Whisper model (both MIT) means including their license notices.
