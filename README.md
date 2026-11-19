# Local Whisper Subtitles

Chrome extension (MV3) that shows live subtitles on YouTube using a local `whisper.cpp` server. Audio never leaves your machine.

## Setup

1. Build whisper.cpp and download `ggml-large-v3-turbo.bin` (one time).
2. Register the auto-start helper (one time):
   ```bash
   native-host/install.sh                      # defaults to ~/projects/whisper.cpp
   native-host/install.sh /path/to/whisper.cpp /path/to/model.bin
   ```
3. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
   The manifest pins the extension ID (`fehpgpahkmanekioejihbpihpbacdjgb`); the helper only accepts that ID.
4. Open a YouTube video, click the extension icon → **Start subtitles**.

The first **Start** with nothing answering at the server URL launches `whisper-server` (Metal, about 4 s to load the model) through the helper. It then keeps running between sessions, so later starts are instant, and shuts down when Chrome quits. A server you started yourself is used as-is and never stopped. Server log: `~/Library/Logs/local-whisper-subtitles.log`. Extra server flags go in `"args"` in `native-host/config.json`. To remove the helper, run `native-host/uninstall.sh`.

Server URL, language, mode and timing are on the **Options** page (popup → Settings). Only `http://127.0.0.1` / `http://localhost` URLs are accepted, on any port.

## How it works

### Lookahead mode (default)

Subtitles appear on time, or slightly before the speech.

```
your tab ── main-state (time, paused, rate) ──▶ background ◀── scout-state / scout-audio ── hidden muted tab
   ▲                                                │                                         (same video, ahead)
   └──────── cues on the video timeline ────────────┘── POST /inference (verbose_json)
```

- Starting opens a muted copy of the video in the next tab. It is briefly shown, because Chrome won't start media in a tab that was never visible. Focus then returns to your tab. Its audio comes from `video.captureStream()`.
- Audio is cut into 8 s windows that **don't overlap**. Each window starts where the last *complete* Whisper segment ended, and segments within 1 s of the edge are redone in the next window. Segment timestamps put each cue at an exact video time.
- Your tab shows the cue at `currentTime + showEarlySec`. It pauses the video ("Preparing subtitles…") at start and after a seek into a part not yet transcribed, until `minLeadSec` is ready. Press play to override.
- The hidden tab follows seeks, video changes and playback rate. It pauses once it is `maxLeadSec` ahead and skips ads when it can.
- Cost: the video streams twice.

### Live mode (and all live streams)

```
popup → background (tabCapture stream id) → offscreen document
  getUserMedia(tab) ─┬─ AudioContext → speakers (tab keeps playing)
                     └─ AudioContext @16 kHz → AudioWorklet → ring buffer
  every step: WAV window (16 kHz mono s16) → POST /inference → dedup → overlay
```

- 6 s window, 4 s step (2 s overlap). Text dedup handles the overlap.
- **Backpressure:** one request in flight. Audio collects in a fixed-size ring buffer, so the next window simply grows (up to 12 s) and older audio is skipped. A "delayed" badge appears past 10 s of lag.

### Shared

- No ffmpeg/webm: PCM is captured directly and sent as 16 kHz mono WAV.
- Serbian output is converted to one script (Latin by default; Options → Serbian script).
- Dedup (`src/text.js`): longest suffix/prefix token match, ignoring case, punctuation, diacritics and script, with one-edit typo tolerance.

## Tests

```bash
npm test
```
