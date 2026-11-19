import json
import os
import signal
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "config.json")
LOG = os.path.expanduser("~/Library/Logs/chrome-transcriber.log")
START_TIMEOUT_SEC = 110
LOCAL_HOSTS = ("127.0.0.1", "localhost")

child = None


def read_message():
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("<I", header)
    return json.loads(sys.stdin.buffer.read(length))


def send(message):
    data = json.dumps(message).encode()
    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()


def reachable(host, port):
    request = urllib.request.Request(f"http://{host}:{port}/inference", data=b"", method="POST")
    try:
        urllib.request.urlopen(request, timeout=2)
    except urllib.error.HTTPError:
        return True
    except OSError:
        return False
    return True


def stop_child():
    global child
    if child and child.poll() is None:
        child.terminate()
        try:
            child.wait(5)
        except subprocess.TimeoutExpired:
            child.kill()
    child = None


def start(host, port):
    global child
    if host not in LOCAL_HOSTS:
        return send({"status": "error", "error": "Only 127.0.0.1/localhost is allowed"})
    if reachable(host, port):
        return send({"status": "ready"})

    with open(CONFIG) as f:
        config = json.load(f)
    if host == "localhost":
        host = "127.0.0.1"
    command = [config["server"], "-m", config["model"], "--host", host, "--port", str(port), *config.get("args", [])]
    log = open(LOG, "ab")
    log.write(f"\n=== {time.ctime()} {' '.join(command)}\n".encode())
    log.flush()
    child = subprocess.Popen(
        command,
        cwd=os.path.dirname(config["server"]),
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=log,
    )

    deadline = time.time() + START_TIMEOUT_SEC
    while time.time() < deadline:
        code = child.poll()
        if code is not None:
            child = None
            return send({"status": "error", "error": f"whisper-server exited with code {code}; see {LOG}"})
        if reachable(host, port):
            return send({"status": "ready"})
        time.sleep(0.5)
    stop_child()
    send({"status": "error", "error": f"whisper-server did not start in {START_TIMEOUT_SEC} s; see {LOG}"})


def main():
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        while (message := read_message()) is not None:
            if message.get("cmd") == "start":
                start(message.get("host", "127.0.0.1"), int(message.get("port", 8080)))
            elif message.get("cmd") == "stop":
                stop_child()
    finally:
        stop_child()


if __name__ == "__main__":
    main()
