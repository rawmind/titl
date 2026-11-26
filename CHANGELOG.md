# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org).

## Unreleased

### Added
- **Better Serbian and Croatian on CPU:** when the spoken language is Serbian or Croatian and the helper runs `small`, Options offers to download [`small-sr-distill-v2`](https://huggingface.co/rawmind/whisper-small-sr-distill-v2) (q8_0, 264 MB), a `small` distilled from `large-v3-turbo` for these two languages. `titl install --serbian` downloads it too. It makes about half as many word errors as `small`: 17.4% against 38.1% in Serbian and 17.9% against 35.5% in Croatian on read speech. It's used only with the language set, not with auto-detect or a larger model, and `small` stays the fallback if it's missing or doesn't start. The download is pinned to one commit and checked by SHA-256.

### Upgrade
- Needs both the new helper and the new extension. Other combinations keep working with the model you have.

## [0.1.21](https://github.com/rawmind/titl/releases/tag/v0.1.21) - 2026-11-24

### Added
- **Speech detection:** with whisper.cpp 1.9.6 or newer, `titl install` also downloads a 0.9 MB Silero model, and whisper-server then skips audio without speech, so silence no longer produces made-up subtitles. It may also skip singing. With older versions it stays off, because 1.9.5 can crash on audio without speech; `titl install --vad` turns it on anyway. `titl install --no-vad` turns it off. Both are remembered. If whisper-server can't start with it, Titl runs it without. `titl status` and Debug info show the setting.
- Automatic language detection ignores replies without speech, which whisper-server labels English when speech detection is on.
- `titl status` and Debug info show the whisper.cpp version, and the flags Titl adds to whisper-server.

### Changed
- **whisper.cpp is pinned** to build `b5907` on Windows and Linux, with its SHA-256 in the helper. That is whisper.cpp 1.9.6 without one later commit, which only changes a CMake file. `titl install` used to take the newest release, and fell back to build `b5454`, which is whisper.cpp 1.9.5. Newer releases are now only tried if the pinned build doesn't run.
- whisper.cpp 1.9.5 makes more mistakes when the audio context is shortened, as Titl does on slow computers. In tests with a Serbian `small` model it made 33.0% word errors on FLEURS, against 27.9% with 1.9.6, and 32.4% against 22.4% on parliament speech (100 clips each, built from source on macOS). At full length the difference was small: 25.2% against 24.6% on the same FLEURS clips.

### Upgrade
- Windows and Linux: new installs get the pinned build. If an older helper downloaded your whisper.cpp, update the helper and run `titl install --update-server` once. It picks the default model again, so if you chose another one, add `--download-model NAME` or `--model PATH`. Skip this if you built whisper.cpp yourself: it would replace your build with the prebuilt one.
- macOS: `brew upgrade whisper.cpp`.
- Speech detection starts after the next `titl install` with whisper.cpp 1.9.6 or newer. Use `titl install --no-vad` to leave it off.
- Update the extension too: without its part of this release, automatic language detection can settle on English during music or noise. Chrome updates it from the Chrome Web Store.

## [0.1.20](https://github.com/rawmind/titl/releases/tag/v0.1.20) - 2026-11-22

### Changed
- **Native whisper.cpp on ARM64 Windows**, for example Windows on a Snapdragon laptop or in UTM or Parallels on an Apple Silicon Mac. The Windows helper is an x64 program, so it used to download the x64 build of whisper.cpp, which then ran through Windows' x64 emulation. It now asks Windows for the real processor and uses the native ARM64 build. `titl install` replaces an x64 build it finds on ARM64 Windows. Debug info shows the processor, and whether the helper itself runs emulated.

### Upgrade
- This release only matters on ARM64 Windows. Everywhere else, updating the helper is optional and the extension only changes Debug info.
- ARM64 Windows: update the helper from the popup, or with `titl update`, then run `titl install` once so it replaces the x64 whisper.cpp with the native ARM64 build. That downloads about 4 MB, and the model stays.
- Chrome updates the extension from the Chrome Web Store.

## [0.1.19](https://github.com/rawmind/titl/releases/tag/v0.1.19) - 2026-11-22

### Added
- **Debug info** at the bottom of Options: Titl and browser versions, your settings, the helper's whisper.cpp build and model, whether whisper.cpp runs on the **CPU or GPU** and with how many threads, the last request's duration, and whether Chrome's translator is available. **Copy** puts it on the clipboard for a bug report. `titl status` also shows CPU or GPU and the thread count. With an older helper, Debug info estimates CPU or GPU from the speed of the last request and says so.

### Changed
- **Faster on slow computers.** Whisper always encodes 30 seconds of audio, even for an 8-second window. When a request takes more than half as long as the audio it covers, Titl asks whisper.cpp to encode only the window plus a second for the rest of the session. That was about 3.5 times faster on a 4-thread CPU, with the same words. Fast machines keep the full context, because the short one makes timestamps less exact.
- The helper's folder is now called `titl` instead of `chrome-transcriber` (`%LOCALAPPDATA%\titl`, `~/Library/Application Support/titl`, `~/.local/share/titl`). Existing installs keep working from the old folder. The next `titl install` moves it, keeping the downloaded models and whisper.cpp, and registers the helper again from there. If the folder can't be moved, for example while Chrome is using it on Windows, the helper keeps using the old one and says so.

### Fixed
- Downloading a translation model no longer sits at "Downloading… 100%". Titl now says it's installing the language pack, and if Chrome hasn't finished within a minute, or the sample translation takes over 10 seconds, it says so and suggests restarting Chrome. The same applies on the YouTube page.
- The first time Chrome translates, it installs its translation engine and refuses to create a translator for a couple of minutes, reporting "Unable to create translator" or "The translation service count exceeded the limitation". Titl now explains that Chrome is still setting up and to try again in a minute. The YouTube page tries again by itself every 15 seconds.
- **Download translation model** can't be clicked again while it's working.

### Upgrade
- Chrome updates the extension from the Chrome Web Store. That alone brings Debug info, the faster mode for slow computers and the translator fixes.
- Updating the helper adds the exact CPU or GPU line to Debug info and the `titl` folder:
  - Windows: the popup offers the update, or run `titl update`. To also move the files to `%LOCALAPPDATA%\titl`, stop subtitles and run the PowerShell install line once more. The installed helper can't move the folder it runs from.
  - macOS: `brew upgrade rawmind/tap/titl`, then `titl install` to move the files.
  - Linux: download `titl-linux-x64` from this release and run `./titl-linux-x64 install`, which also moves the files.
- Until the files are moved, the helper keeps using `chrome-transcriber`, which works just as well.

## [0.1.18](https://github.com/rawmind/titl/releases/tag/v0.1.18) - 2026-11-22

### Added
- **Automatic language detection, now the default.** Titl recognises the spoken language by itself: whisper.cpp guesses the language of each stretch of speech, and once the same language has come up 3 times Titl keeps it for the rest of the video. Serbian script, Chrome's translator and the local LLM follow the detected language, and the popup shows it, e.g. "Serbian (detected)". Close languages such as Serbian, Croatian and Bosnian can be mixed up, so pick yours in **Options → Spoken language** if you know it. Settings you saved earlier keep their language.
- **Choose the translation language in the popup.** The change applies to running subtitles straight away: lines already on screen are translated again, and nothing restarts.

### Changed
- The popup shows the spoken language and the translation target instead of the server address.
- When the helper isn't installed, the popup says so and links to the install steps on the website, in your browser's language and for your system.
- **Options → Translate to** and the popup list languages alphabetically in your interface language. **Off** comes first and stays the default.
- Website: the install steps explain the first start (pinning Titl, language detection and the hidden tab that plays ahead), and each system has its own link: `#installation_macos`, `#installation_windows` and `#installation_linux`.

### Fixed
- The website now builds into `dist/site`. The old `_site` folder stopped Chrome from loading the project folder as an unpacked extension.

### Upgrade
- Chrome updates the extension from the Chrome Web Store.
- The helper only changes its version number, so updating it is optional.

## [0.1.17](https://github.com/rawmind/titl/releases/tag/v0.1.17) - 2026-11-22

### Changed
- The extension's homepage link in `chrome://extensions` opens the [Titl website](https://rawmind.github.io/titl/) instead of the GitHub repository.

### Upgrade
- Chrome updates the extension from the Chrome Web Store. 0.1.17 also brings everything in 0.1.16 below.
- The helper only changes its version number, so updating it is optional.

## [0.1.16](https://github.com/rawmind/titl/releases/tag/v0.1.16) - 2026-11-22

### Added
- **Translate with a local AI model.** Options → Translator → Local LLM uses any OpenAI-compatible server on your computer (llama-server, Ollama, LM Studio). Each line is translated with the lines around it, so sentences split across lines come out right and Serbian is translated as Serbian. Only 127.0.0.1 and localhost are accepted. See the README for models, speed and memory.
- **Subtitle size** in Options (50–300%).

### Changed
- In lookahead mode, the line nearest the playhead is translated first, and pause until ready also waits for the translation, so lines don't show untranslated. Pressing play skips the wait for that line, and a translation that takes too long (10 s for Chrome's translator, 30 s for a local model) shows the line untranslated instead of holding playback.
- Larger text on the Options page.

### Removed
- Homebrew no longer installs `chrome-transcriber-helper`, the helper's name before 0.1.7. Use `titl`. If auto-start stops working after `brew upgrade`, run `titl install` once to register the current name.

### Upgrade
- Chrome updates the extension from the Chrome Web Store.
- The helper only changes its version number, so updating it is optional:
  - macOS: `brew upgrade rawmind/tap/titl`
  - Windows: the popup offers the update, or run `titl update`.
  - Linux: download `titl-linux-x64` from this release and run `./titl-linux-x64 install`.
- To try the local AI translation, see [Local LLM](README.md#local-llm) in the README.

## [0.1.15](https://github.com/rawmind/titl/releases/tag/v0.1.15) - 2026-11-20

### Added
- **The helper updates itself on Windows.** Once a day, when you open Titl's popup, the helper checks for a newer release. The popup then shows what the new version fixes and an **Update** button. The new helper is downloaded, checked against the release's `SHA256SUMS`, and used from the next Start. `titl update` does the same in a terminal.

### Changed
- **The Windows helper is easier to trust.** `titl-windows-x64.exe` now carries its name, description, publisher, version and icon, and registers with browsers through the Windows registry API instead of starting `reg.exe`. Microsoft Defender blocked the previous build during winget validation.

### Upgrade
- Windows: run the PowerShell line once more; from 0.1.15 on, updates come from the popup.
  ```powershell
  irm https://github.com/rawmind/titl/releases/latest/download/install.ps1 | iex
  ```
- macOS: `brew upgrade rawmind/tap/titl`
- Linux: download `titl-linux-x64` from this release and run `./titl-linux-x64 install`.

Then reload the extension in `chrome://extensions`, or let the Chrome Web Store update it.

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
