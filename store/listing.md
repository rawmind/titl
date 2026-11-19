# Chrome Web Store listing: Titl

Everything to paste into the Developer Dashboard for v0.1.3. Images are in this folder.

## Store listing

**Name** (from manifest): `Titl`

**Summary** (manifest `description`, max 132 characters):
> On-time, private subtitles and translation for YouTube, transcribed on your own computer with whisper.cpp.

**Category:** Accessibility
**Language:** English

**Description:**

```
Titl – Local AI subtitles & translation for YouTube

Subtitles for any YouTube video, even ones with no captions, created on your own computer. Nothing is uploaded.

ON TIME, NOT LATE
Other live-subtitle tools show each line seconds after it is spoken. Titl transcribes ahead of what you are watching, so every line appears with the speech, or a moment before.

ACCURATE
Titl uses whisper.cpp with OpenAI's large-v3-turbo Whisper model on your computer's GPU (Metal on Mac, Vulkan or CUDA on Windows and Linux). That is a much larger model than in-browser tools can run.

PRIVATE
Audio goes only to a speech server on your own machine (127.0.0.1). No accounts, no cloud, no analytics.

TRANSLATION BUILT IN
Translate subtitles into English, Russian, German, Spanish and more with Chrome's built-in on-device translator (Chrome 138+). Optionally show the original line above the translation.

MADE FOR SERBIAN, WORKS FOR ~100 LANGUAGES
Serbian output is always in the script you choose (Latin or Cyrillic), never a mix. Any language Whisper supports works.

REQUIRES A FREE LOCAL HELPER
Titl needs whisper.cpp and a small helper program on your computer that starts it automatically:
  macOS:   brew install rawmind/tap/titl
           chrome-transcriber-helper install
  Others:  see https://github.com/rawmind/titl
The helper finds whisper.cpp, downloads a model if needed (about 550 MB) and connects it to Chrome.

HOW TO USE
Open a YouTube video, click the Titl icon, then Start subtitles. For the first few seconds the video pauses while subtitles are prepared.

Open source (MIT): https://github.com/rawmind/titl

Titl is not affiliated with or endorsed by Google or YouTube. Google Chrome™ and YouTube™ are trademarks of Google LLC.
```

**Graphics**
- Store icon: `icons/icon128.png`
- Small promo tile (440×280): `store/promo-tile-440x280.png`
- Screenshots (1280×800, at least 1, up to 5). Still to be captured from the real extension:
  1. A YouTube video with Serbian subtitles in the overlay
  2. Translation on: Russian or English line with the Serbian original above it
  3. The popup showing "Running (lookahead)"
  4. The Options page
  5. The helper's `install` output in Terminal

**Additional fields**
- Homepage URL: https://github.com/rawmind/titl
- Support URL: https://github.com/rawmind/titl/issues

## Privacy practices

**Single purpose:**
> Show subtitles, optionally translated, for the YouTube video the user is watching, transcribed by a speech-recognition server on the user's own computer.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `tabCapture` | Live mode (used for YouTube live streams) captures the audio of the YouTube tab the user started subtitles in, after the user clicks Start, so it can be transcribed by the user's local speech server. |
| `offscreen` | Live mode needs an offscreen document to receive the captured tab audio and convert it to 16 kHz WAV, because service workers cannot use the Web Audio API. |
| `activeTab` | Lets live mode capture the tab the user invoked the extension on, and only that tab. |
| `scripting` | Injects the subtitle overlay into YouTube tabs that were already open before the extension was installed or updated, and injects the audio reader into the muted lookahead tab the extension opens itself. |
| `storage` | Saves the user's settings (server address, language, script, translation, timing) and the current session state shown in the popup. |
| `nativeMessaging` | Talks to the optional companion program (chrome-transcriber-helper) that starts the user's local whisper.cpp speech server when the user clicks Start. No other native program is contacted. |
| `tabGroups` | Puts the muted lookahead tab, which plays the same video a few seconds ahead so subtitles are ready on time, into a collapsed tab group so it doesn't clutter the user's tab strip. |
| Host `https://www.youtube.com/*` | Shows the subtitle overlay on the YouTube player, reads the video's playback position to time subtitles, and reads the audio of the lookahead copy of the video. |
| Host `http://127.0.0.1/*`, `http://localhost/*` | Sends audio to the speech-recognition server running on the user's own computer. The extension refuses any non-local server address. |

**Remote code:** No, I am not using remote code. All JavaScript is included in the package.

**Data usage:** tick no data types. Audio and subtitle text are processed only on the user's device (the local server at 127.0.0.1) and are never transmitted to the developer or any third party. Then certify all three statements:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/rawmind/titl/blob/master/PRIVACY.md

## Notes for reviewers ("Test instructions")

```
Titl transcribes YouTube audio with whisper.cpp running on the user's own computer, so it needs a local speech server to show subtitles.

To test on macOS:
  1. brew install rawmind/tap/titl
  2. chrome-transcriber-helper install --download-model small
     (small model is ~470 MB and fast to download; the helper registers itself with Chrome)
  3. Open any YouTube video with speech, click the Titl icon, then "Start subtitles".

Any whisper.cpp server also works without the helper:
  whisper-server -m ggml-small.bin --host 127.0.0.1 --port 8080
then untick "Start whisper-server automatically" in Titl's options.

Without a local server, Start shows "whisper-server is not running…" by design: no audio is ever sent off the device.

The muted second tab in a collapsed "Titl" group is intentional ("lookahead" mode): it plays the same video a few seconds ahead so subtitles appear on time instead of late. Live mode (Options → Mode) uses only the current tab.
```

## Distribution
- Visibility: start with **Unlisted**, then switch to Public after checking the store build.
- Regions: all.
