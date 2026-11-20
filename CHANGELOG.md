# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org).

## [0.1.14](https://github.com/rawmind/titl/releases/tag/v0.1.14) - 2026-11-20

### Fixed
- **Translation works again.** Since 0.1.12, turning on translation always ended in "Translation unavailable: can't access 't' before initialization".

### Added
- **Easier setup on Windows.** Install the helper with one line in PowerShell:
  ```powershell
  irm https://github.com/rawmind/titl/releases/latest/download/install.ps1 | iex
  ```
  The script downloads the helper, checks it against the release's `SHA256SUMS` and runs `titl install`. Or download `titl-windows-x64.exe` and double-click it: it sets everything up and keeps the window open until you press Enter.
- When the helper is downloaded on its own, `titl install` ends with a link to Titl in the Chrome Web Store instead of "Load unpacked" steps.

### Changed
- Tagged releases upload the extension to the Chrome Web Store as a draft; submitting it for review is done in the dashboard.

### Upgrade
- macOS: `brew upgrade rawmind/tap/titl`
- Windows: run the PowerShell line above.
- Linux: download `titl-linux-x64` from this release and run `./titl-linux-x64 install`.

Then reload the extension in `chrome://extensions`, or let the Chrome Web Store update it.

## [0.1.13](https://github.com/rawmind/titl/releases/tag/v0.1.13) - 2026-11-20

### Changed
- **Chrome Web Store releases are automated.** Each tagged version is uploaded to the Chrome Web Store and submitted for review; once approved, it is published from the dashboard.
- Clearer Russian and Ukrainian store summaries.

### Upgrade
No helper changes. Chrome Web Store installs update on their own; for an unpacked install, reload the extension in `chrome://extensions`.

## [0.1.12](https://github.com/rawmind/titl/releases/tag/v0.1.12) - 2026-11-20

### Added
- **Titl speaks your language.** The popup, Options page and on-screen messages are translated into 12 languages: English, Chinese, Hindi, Spanish, Arabic, French, Bengali, Portuguese, Russian, Indonesian, Ukrainian and Serbian. Chrome picks the language from your browser settings, and Arabic is shown right to left. Everything else falls back to English. Language names in the dropdowns appear in your language too.
- A small **"♥ Support on Ko-fi"** link at the bottom of the Options page. Titl stays free, with no paid features.

### Changed
- CI runs on the Node 24 versions of GitHub's actions.

### Upgrade
```bash
brew upgrade rawmind/tap/titl
```
Then reload the extension in `chrome://extensions`.

## [0.1.11](https://github.com/rawmind/titl/releases/tag/v0.1.11) - 2026-11-20

### Fixed
- **V works on any keyboard layout.** On Cyrillic layouts (Serbian, Russian, Ukrainian), Greek and others, the V key now toggles the translation blur even though it types another letter. On layouts where "v" sits elsewhere (Dvorak), the key that types "v" works. A physical V key that types a different Latin letter (like Dvorak's "k", YouTube's play/pause) is left alone.

### Upgrade
```bash
brew upgrade rawmind/tap/titl
```
Then reload the extension in `chrome://extensions`.

## [0.1.10](https://github.com/rawmind/titl/releases/tag/v0.1.10) - 2026-11-20

Practise listening with a hidden translation, and settings that apply immediately.

### Added
- **Blur the translation until you reveal it** (Options → Translation). Press **V** or click the line to reveal the translation; it stays revealed for the following lines until you press V again. A small hint shows what V will do. The original line stays readable. V does nothing while you type (e.g. in YouTube's search box) or with Ctrl/Cmd/Alt, and it isn't one of YouTube's own shortcuts. Clicking the line doesn't pause the video.

### Changed
- **Save applies settings right away.** If subtitles are running, Save restarts them with the new settings ("Saved and applied to the running subtitles"). If nothing is running, it just saves.

### Fixed
- After reloading the extension, the YouTube tab could keep running the old page script, so new features like the blur didn't work until the page was reloaded. A fresh script now replaces a stale one.
- No readable flash of the translation when a new line appears in blur mode.

### Security
- Updated the `zip` library used to unpack the downloaded whisper.cpp on Windows to 9.x. This fixes three advisories (one critical) about malformed archives. Downloads were already verified against GitHub's checksums.

### Upgrade
```bash
brew upgrade rawmind/tap/titl
```
Then reload the extension in `chrome://extensions`.

## [0.1.9](https://github.com/rawmind/titl/releases/tag/v0.1.9) - 2026-11-20

Windows and Linux setup is now one command, and the local server no longer needs a fixed port.

### Added
- **`titl install` downloads whisper.cpp** on Windows and Linux when none is found: the CUDA build with an NVIDIA GPU, otherwise the CPU build. Every download is checked against GitHub's published SHA-256 and test-run before use. If the CUDA build or the newest release doesn't work, the helper falls back to the previous release or the CPU build by itself. If GitHub can't be reached, it uses a known-good build pinned in the helper.
- `titl install --update-server` fetches the newest whisper.cpp, and `--cpu` skips the CUDA build.
- The default model follows the hardware: `large-v3-turbo` with a GPU, `small` on CPU.

### Changed
- **whisper-server runs on a random free port above 10000.** The helper picks it and tells the extension, so nothing clashes with other software on port 8080. Older extensions that ask for a specific port (like 8080) still get it.
- The Options server address is now only for a whisper-server you run yourself, or as a fallback when the helper isn't installed. While running, the popup shows the actual address.
- CI installs whisper.cpp exactly as users do, and runs weekly to catch upstream file renames early.

### Upgrade
```bash
brew upgrade rawmind/tap/titl
```
Windows and Linux: download the new `titl` binary from this release and run `titl install`. Then reload the extension in `chrome://extensions`.

## [0.1.8](https://github.com/rawmind/titl/releases/tag/v0.1.8) - 2026-11-20

Choose languages from a list instead of typing codes.

### Changed
- **Spoken language** in Options is now a dropdown of all ~100 languages Whisper supports, sorted by name and shown with their native name (e.g. "Serbian · српски"). No more typing `sr` or `ru`.
- **Translate to** is ordered by number of speakers worldwide (English, Chinese, Hindi, Spanish, Arabic, French, …) and now includes Hindi, Arabic, Bengali, Indonesian, Marathi, Telugu, Tamil, Vietnamese, Thai and other major languages. If Chrome's on-device translator doesn't support a pair, Titl says so.
- The popup shows the language name ("Serbian") instead of its code.
- **Serbian script** only appears in Options when the spoken language is Serbian, the only language it applies to.

### Upgrade
```bash
brew upgrade rawmind/tap/titl
```
Then reload the extension in `chrome://extensions`.

## [0.1.7](https://github.com/rawmind/titl/releases/tag/v0.1.7) - 2026-11-20

The helper command is now simply **`titl`**.

### Changed
- `chrome-transcriber-helper` is renamed to **`titl`**: `titl install`, `titl status`, `titl uninstall`. Homebrew keeps `chrome-transcriber-helper` as an alias, so existing commands, scripts and browser registrations keep working.
- Non-Homebrew installs replace the old `chrome-transcriber-helper` copy in the helper's folder. `uninstall` removes both names.
- The extension's error message and Options text refer to `titl install`.

Unchanged on purpose: the native messaging host name (`com.chrome_transcriber.host`) and the settings folder (`chrome-transcriber`). Changing them would break the Chrome Web Store build and existing setups.

### Upgrade
```bash
brew upgrade rawmind/tap/titl
titl install
```

## [0.1.6](https://github.com/rawmind/titl/releases/tag/v0.1.6) - 2026-11-20

The helper now works with Titl installed from the Chrome Web Store.

### Added
- The helper accepts the Chrome Web Store build of Titl (`bpapgchpopccpbgbkfldmdmfmddgoeme`) as well as the unpacked one. No `--extension-id` flag is needed, and `status` detects either.

### Upgrade
```bash
brew upgrade rawmind/tap/titl
chrome-transcriber-helper install
```
`install` re-registers the helper so Chrome lets the store version start whisper-server.

## [0.1.5](https://github.com/rawmind/titl/releases/tag/v0.1.5) - 2026-11-20

A new look for the popup and the Options page, matching the Titl icon.

### Changed
- **Popup:** dark design in Titl's colours. The status sits in a rounded box with a dot that pulses while running, and **▶ Start subtitles** is a yellow pill button. While running it becomes a dark **■ Stop subtitles** button.
- **Options:** each section is a dark rounded card with a yellow heading. Inputs, selects and checkboxes are restyled, **Save** is the yellow pill, and the Save bar stays visible while you scroll.
- Both pages share one stylesheet (`src/theme.css`).

### Upgrade
```bash
brew upgrade rawmind/tap/titl
```
Then reload the extension in `chrome://extensions`.

## [0.1.4](https://github.com/rawmind/titl/releases/tag/v0.1.4) - 2026-11-20

The Homebrew formula is now called **titl**.

### Changed
- Install with `brew install rawmind/tap/titl`. Existing `chrome-transcriber` installs are migrated automatically by Homebrew.
- The GitHub repository moved to [rawmind/titl](https://github.com/rawmind/titl). Old links redirect.
- The extension folder for Homebrew installs is now `$(brew --prefix)/opt/titl/share/titl/extension`.

### Fixed
- The helper recognizes the `titl` formula's paths, so it registers Homebrew's stable `opt/titl` path and finds the extension folder. It still recognizes the old `chrome-transcriber` paths.

### Upgrade
```bash
brew update && brew upgrade
chrome-transcriber-helper install
```
If you loaded the extension from the Homebrew folder, load it again from the new path above (`install` prints it).

## [0.1.3](https://github.com/rawmind/titl/releases/tag/v0.1.3) - 2026-11-20

Prepares the extension for the Chrome Web Store under its new name, **Titl**.

### Changed
- The extension is now called **Titl** ("subtitle" in Serbian/Croatian). Chrome's branding rules don't allow "Chrome" in an extension's name. The repository, helper and Homebrew formula keep the name `chrome-transcriber`.
- **Ad skipping is now opt-in** (Options → Timing, off by default). Before, the hidden lookahead tab clicked "Skip ad" automatically.
- The hidden lookahead tab's group is now titled "Titl". Leftover "Transcriber" groups are still cleaned up.

### Added
- Icons and a Chrome Web Store promo tile.
- `npm run package` builds the store zip (`dist/titl-<version>.zip`) without the manifest `key`.
- `chrome-transcriber-helper install --extension-id ID` also accepts another extension ID (e.g. the Web Store build) and remembers it. `status` detects the extension under any accepted ID.
- [PRIVACY.md](PRIVACY.md) and the store listing text in `store/listing.md`.

### Upgrade
```bash
brew upgrade rawmind/tap/chrome-transcriber
```
Then reload the extension in `chrome://extensions`.

## [0.1.2](https://github.com/rawmind/titl/releases/tag/v0.1.2) - 2026-11-20

Makes the last setup step obvious on a fresh machine: `chrome-transcriber-helper install` registers the helper, but Chrome only adds extensions from the Web Store automatically, so the extension still has to be loaded once by hand.

### Added
- `install` ends with the steps to load the extension in Chrome (**Developer mode → Load unpacked**). It copies the extension folder's path to the clipboard and reveals the folder in Finder (Explorer on Windows, the file manager on Linux). If the extension is already loaded, it says so instead.
- `status` reports whether the extension is loaded or disabled, per browser and profile, and from which folder.
- The helper finds the extension folder in both Homebrew installs (stable `opt/` path) and source checkouts.

### Docs
- README: what `install` does and doesn't do, plus a troubleshooting row for "extension doesn't appear in Chrome".

### Upgrade
```bash
brew upgrade rawmind/tap/chrome-transcriber
```

## [0.1.1](https://github.com/rawmind/titl/releases/tag/v0.1.1) - 2026-11-19

### Fixed
- Auto-start broke after `brew upgrade whisper-cpp`. The helper saved `whisper-server` as Homebrew's versioned path (`Cellar/whisper.cpp/<version>/…`), which is deleted on upgrade. It now keeps the stable `/opt/homebrew/bin/whisper-server` link. Users on 0.1.0 should upgrade and run `chrome-transcriber-helper install` once.

### Upgrade
```bash
brew upgrade rawmind/tap/chrome-transcriber
chrome-transcriber-helper install
```

## [0.1.0](https://github.com/rawmind/titl/releases/tag/v0.1.0) - 2026-11-19

First release. YouTube subtitles in Chrome, transcribed on your own machine by [whisper.cpp](https://github.com/ggml-org/whisper.cpp). Audio never leaves your computer. Built for Serbian, and works with any language Whisper supports.

### Extension
- **Lookahead mode (default):** a muted copy of the video plays ahead in a collapsed "Transcriber" tab group, so subtitles appear on time, or slightly before the speech. Each cue is pinned to the video time using Whisper's segment timestamps. The extension follows seeks, playback speed, video changes and ads, and briefly pauses the video until subtitles are ready.
- **Live mode:** transcribes the tab's own audio. Used automatically for live streams.
- **Serbian script:** output is always Latin or always Cyrillic, never a mix.
- **On-device translation** using Chrome's built-in Translator API (Chrome 138+). Serbian is translated via Croatian. The original can be shown above the translation.
- Subtitle overlay works in normal and fullscreen mode and doesn't block YouTube's controls.
- Options page: server URL with a connection test, mode, timing, language, script, translation.
- Handles extension reloads cleanly and closes stray lookahead tabs.

### Helper (`chrome-transcriber-helper`, Rust)
- `install`: finds `whisper-server` and a model (or downloads `large-v3-turbo-q5_0` from Hugging Face), then registers with Chrome, Chromium, Edge and Brave on macOS, Linux and Windows.
- Starts `whisper-server` when you press Start and keeps it running until Chrome quits.
- `status`, `uninstall [--purge]`.

### Install
```bash
brew install rawmind/tap/chrome-transcriber
chrome-transcriber-helper install
```
Then load the extension: `chrome://extensions` → Developer mode → **Load unpacked** → `$(brew --prefix)/opt/chrome-transcriber/share/chrome-transcriber/extension`.

### Known limitations
- Only tested on macOS (Apple Silicon). Windows and Linux support in the helper is untested.
- Lookahead mode streams the video twice.
- The extension is not in the Chrome Web Store yet, so it needs Developer mode.
