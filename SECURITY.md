# Security policy

## Supported versions

Only the latest release of Titl (the extension and the `titl` helper) receives security fixes. Please update before reporting:

- Homebrew: `brew upgrade rawmind/tap/titl`
- Windows / Linux: download the newest `titl` from [Releases](https://github.com/rawmind/titl/releases/latest) and run `titl install`
- Chrome Web Store: updates install automatically

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Instead, either:

- email **[titl@devs.team](mailto:titl@devs.team)**, or
- use GitHub's [private vulnerability reporting](https://github.com/rawmind/titl/security/advisories/new).

Include what's affected (extension, helper, version, OS), steps to reproduce, and the impact you see. You'll get an acknowledgement within 7 days. Fixes ship in a new release, credited to you unless you prefer otherwise.

## What's in scope

- **The extension:** for example, code running on pages it shouldn't, data leaving the device, or permission misuse.
- **The `titl` helper:** registration with browsers, the native messaging host, and how it downloads, verifies and runs whisper.cpp and models.
- **Release artifacts:** the binaries attached to GitHub releases and the Homebrew formula in [rawmind/homebrew-tap](https://github.com/rawmind/homebrew-tap).

Problems in whisper.cpp itself, Chrome, or YouTube should go to those projects.

## How Titl is designed to be safe

- **Audio stays on your computer.** The extension only sends audio to a server on `127.0.0.1` or `localhost` and refuses any other address.
- **Only Titl can start the helper.** Chrome lets only Titl's own extension IDs talk to it.
- **The helper refuses non-local hosts** and starts whisper-server bound to `127.0.0.1` only.
- **Downloads are verified.** whisper.cpp builds come only from [ggml-org/whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases), are checked against GitHub's published SHA-256, and are test-run before use. Models come from Hugging Face over HTTPS, and the speech-detection model is also checked against a fixed SHA-256.
- **Releases are traceable.** Commits and tags are GPG-signed, release binaries are built by GitHub Actions with a `SHA256SUMS` file, and dependencies are monitored by Dependabot.

**Known limitation:** while it runs, whisper-server accepts requests on `127.0.0.1` without authentication, so other programs on the same computer could send it audio to transcribe. It never listens on your network, and it stops when Chrome quits.
