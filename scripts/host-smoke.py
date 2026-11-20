import json
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.request
import uuid

HOST_NAME = "com.chrome_transcriber.host"
REQUIRED_ORIGINS = [
    "chrome-extension://fehpgpahkmanekioejihbpihpbacdjgb/",
    "chrome-extension://bpapgchpopccpbgbkfldmdmfmddgoeme/",
]
COMPAT_PORT = 18091


def send(proc, message):
    data = json.dumps(message).encode()
    proc.stdin.write(struct.pack("<I", len(data)) + data)
    proc.stdin.flush()


def receive(proc):
    header = proc.stdout.read(4)
    if len(header) < 4:
        raise SystemExit("helper closed the connection without replying")
    (length,) = struct.unpack("<I", header)
    return json.loads(proc.stdout.read(length))


def transcribe(port, wav_path, language):
    boundary = uuid.uuid4().hex
    with open(wav_path, "rb") as f:
        audio = f.read()
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode(),
        audio,
        f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n{language}'.encode(),
        f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson'.encode(),
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/inference",
        data=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.loads(response.read())["text"]


def port_open(port):
    try:
        socket.create_connection(("127.0.0.1", port), timeout=1).close()
        return True
    except OSError:
        return False


def main():
    manifest_path, wav_path, language, expected = sys.argv[1:5]
    with open(manifest_path) as f:
        manifest = json.load(f)
    assert manifest["name"] == HOST_NAME, manifest
    assert manifest["type"] == "stdio", manifest
    for origin in REQUIRED_ORIGINS:
        assert origin in manifest["allowed_origins"], manifest["allowed_origins"]
    assert os.path.isfile(manifest["path"]), manifest["path"]
    print("manifest ok:", manifest["path"])

    args = [manifest["path"], REQUIRED_ORIGINS[0]]
    if os.name == "nt":
        args.append("--parent-window=0")
    proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    send(proc, {"cmd": "start", "host": "example.com"})
    reply = receive(proc)
    assert reply["status"] == "error", reply
    print("non-local host refused")

    started = time.time()
    send(proc, {"cmd": "start", "host": "127.0.0.1"})
    reply = receive(proc)
    assert reply["status"] == "ready", reply
    port = reply["port"]
    assert 10000 <= port <= 65535, reply
    print(f"whisper-server ready on random port {port} in {time.time() - started:.1f} s")

    text = transcribe(port, wav_path, language)
    print("transcript:", text.strip())
    assert expected.lower() in text.lower(), f"expected {expected!r}"

    send(proc, {"cmd": "start", "host": "127.0.0.1"})
    again = receive(proc)
    assert again == {"status": "ready", "port": port}, again
    print("second start reuses the running server")

    send(proc, {"cmd": "start", "host": "127.0.0.1", "port": COMPAT_PORT})
    compat = receive(proc)
    assert compat == {"status": "ready", "port": COMPAT_PORT}, compat
    assert expected.lower() in transcribe(COMPAT_PORT, wav_path, language).lower()
    print(f"explicit port {COMPAT_PORT} still honoured")

    proc.stdin.close()
    proc.wait(timeout=30)
    deadline = time.time() + 15
    while (port_open(port) or port_open(COMPAT_PORT)) and time.time() < deadline:
        time.sleep(0.5)
    assert not port_open(port) and not port_open(COMPAT_PORT), "whisper-server still running after the helper exited"
    print("whisper-server stopped with the helper")
    print("OK")


if __name__ == "__main__":
    main()
