#!/bin/sh
set -eu
HOST_NAME=com.local_whisper_subtitles.host
HERE=$(cd "$(dirname "$0")" && pwd)
rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json" \
      "$HOME/Library/Application Support/Chromium/NativeMessagingHosts/$HOST_NAME.json" \
      "$HERE/config.json" "$HERE/run-host.sh"
echo "Auto-start helper removed."
