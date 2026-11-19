# Privacy policy for Titl

_Last updated: 2026-11-20_

Titl (the "Chrome Transcriber" project) creates subtitles for YouTube videos on your own computer. It is built so that your data never leaves your device.

## What Titl processes

- **Audio of the YouTube video you choose to subtitle.** It is captured only after you press **Start subtitles**, and only from that video. Titl sends it to a speech-recognition server (whisper.cpp) running **on your own computer**, at `127.0.0.1` or `localhost`. The extension refuses any other address. Audio is processed in memory and is not stored.
- **Subtitle text.** It is kept in memory in your YouTube tab while subtitles are shown, and discarded when you stop or close the tab.
- **Translation.** If you turn translation on, subtitle text is translated by Chrome's built-in on-device translator. The text is not sent to any translation service.
- **Settings.** Your choices on the Options page (server address, language, display preferences) are stored in your browser's local extension storage.

## What Titl does not do

- It does not send audio, subtitles, browsing history or any other data to the developer or to any third party.
- It has no analytics, no tracking, no advertising and no user accounts.
- It does not read or change any website other than YouTube, and on YouTube only the video player.

## The local helper

The optional companion program `chrome-transcriber-helper` runs on your computer. It starts the local whisper.cpp server when the extension asks for it. When you run its `install` command, it may download a Whisper model file from Hugging Face (`huggingface.co`). That is a plain file download with no personal data attached. The helper sends nothing else over the network.

## YouTube

Titl works on YouTube pages that you open. In its default "lookahead" mode, it opens a second, muted copy of the same video in a collapsed tab, so subtitles can be prepared before the speech. That tab is an ordinary YouTube page, subject to YouTube's own [terms](https://www.youtube.com/t/terms) and Google's [privacy policy](https://policies.google.com/privacy). Titl does not collect anything from it beyond the audio described above.

## Contact

Questions or concerns: open an issue at https://github.com/rawmind/chrome-transcriber/issues.
