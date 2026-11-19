#!/bin/sh
set -eu

HOST_NAME=com.chrome_transcriber.host
EXTENSION_ID=fehpgpahkmanekioejihbpihpbacdjgb
HERE=$(cd "$(dirname "$0")" && pwd)

WHISPER_DIR=${1:-$HOME/projects/whisper.cpp}
WHISPER_DIR=$(cd "$WHISPER_DIR" && pwd)
MODEL=${2:-$WHISPER_DIR/models/ggml-large-v3-turbo.bin}
SERVER=$WHISPER_DIR/build/bin/whisper-server

[ -x "$SERVER" ] || { echo "Not found: $SERVER (build whisper.cpp first)" >&2; exit 1; }
[ -f "$MODEL" ] || { echo "Not found: $MODEL" >&2; exit 1; }

PYTHON=$(python3 -c 'import sys; print(sys.executable)')

python3 - "$HERE/config.json" "$SERVER" "$MODEL" <<'EOF'
import json, sys
path, server, model = sys.argv[1:]
json.dump({"server": server, "model": model, "args": []}, open(path, "w"), indent=2)
EOF

cat > "$HERE/run-host.sh" <<EOF
#!/bin/sh
exec "$PYTHON" "$HERE/host.py" "\$@"
EOF
chmod +x "$HERE/run-host.sh"

for BROWSER_DIR in \
  "$HOME/Library/Application Support/Google/Chrome" \
  "$HOME/Library/Application Support/Chromium"; do
  [ -d "$BROWSER_DIR" ] || continue
  mkdir -p "$BROWSER_DIR/NativeMessagingHosts"
  cat > "$BROWSER_DIR/NativeMessagingHosts/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Starts whisper-server for Chrome Transcriber",
  "path": "$HERE/run-host.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
  echo "Registered with $(basename "$BROWSER_DIR")"
done

echo "whisper-server: $SERVER"
echo "model:          $MODEL"
echo "Extra server flags can be added to \"args\" in $HERE/config.json"
