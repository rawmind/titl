# Privacy policy for Titl

_Last updated: 2026-11-22_

Titl creates subtitles for YouTube videos on your own computer. It is built so that your data never leaves your device.

## What Titl processes

- **Audio of the YouTube video you choose to subtitle.** It is captured only after you press **Start subtitles**, and only from that video. Titl sends it to a speech-recognition server (whisper.cpp) running **on your own computer**, at `127.0.0.1` or `localhost`. The extension refuses any other address. Audio is processed in memory and is not stored.
- **Subtitle text.** It is kept in memory in your YouTube tab while subtitles are shown, and discarded when you stop or close the tab.
- **Translation.** If you turn translation on, subtitle text is translated either by Chrome's built-in on-device translator or, if you choose **Local LLM**, by a language model server running **on your own computer** at `127.0.0.1` or `localhost`. The extension refuses any other address. The text is not sent to any translation service.
- **Settings.** Your choices on the Options page (server address, language, display preferences) are stored in your browser's local extension storage.

## What Titl does not do

- It does not send audio, subtitles, browsing history or any other data to the developer or to any third party.
- It has no analytics, no tracking, no advertising and no user accounts.
- It does not read or change any website other than YouTube, and on YouTube only the video player.

## The local helper

The optional companion program `titl` runs on your computer. It starts the local whisper.cpp server when the extension asks for it. It uses the network only to download files it needs, with no personal data attached:

- When you run its `install` command, it may download Whisper model files and a small speech-detection model from Hugging Face (`huggingface.co`) and, on Windows and Linux, a prebuilt whisper.cpp from GitHub (`github.com`).
- On Windows, at most once a day when you open Titl's popup, it asks GitHub (`api.github.com`) for Titl's latest public release. If you click **Update**, it downloads the new helper from `github.com`.

As with any download, these sites see your IP address and which file is requested. The helper sends nothing else over the network.

## YouTube

Titl works on YouTube pages that you open. In its default "lookahead" mode, it opens a second, muted copy of the same video in a collapsed tab, so subtitles can be prepared before the speech. That tab is an ordinary YouTube page, subject to YouTube's own [terms](https://www.youtube.com/t/terms) and Google's [privacy policy](https://policies.google.com/privacy). Titl does not collect anything from it beyond the audio described above.

## Website

This policy covers the Titl extension and helper. The project website, https://rawmind.github.io/titl/, uses Google Analytics to count visits only after you click **Allow** in its banner; until then nothing is loaded from Google. You can change your choice under **Cookie settings** at the bottom of the site. Google Analytics is subject to Google's [privacy policy](https://policies.google.com/privacy).

## Contact

Questions or concerns: email [titl@devs.team](mailto:titl@devs.team) or open an issue at https://github.com/rawmind/titl/issues.
