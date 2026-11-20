import glob
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ORIGIN = "chrome-extension://bpapgchpopccpbgbkfldmdmfmddgoeme/"
ASSET = "titl-windows-x64.exe"
NOTES = "### Fixed\n- **Updater works on Windows.** Details.\n\n### Added\n- A [new](https://example.com) `thing`.\n\n### Upgrade\n- ignored\n"


def ask(exe, message, env):
    proc = subprocess.Popen([exe, ORIGIN], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)
    data = json.dumps(message).encode()
    proc.stdin.write(struct.pack("<I", len(data)) + data)
    proc.stdin.flush()
    header = proc.stdout.read(4)
    if len(header) < 4:
        raise SystemExit(f"helper closed the connection without replying to {message}")
    (length,) = struct.unpack("<I", header)
    reply = json.loads(proc.stdout.read(length))
    proc.stdin.close()
    proc.wait(timeout=60)
    print(f"{message['cmd']} -> {reply}")
    return reply


def version(exe):
    return subprocess.run([exe, "--version"], capture_output=True, text=True, check=True).stdout.strip()


def main(installed, fresh, new_version):
    data_dir = os.path.dirname(installed)
    old_version = version(installed)
    tag = f"v{new_version}"
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, tag))
    shutil.copy(fresh, os.path.join(root, tag, ASSET))
    with open(os.path.join(root, "latest.json"), "w") as f:
        json.dump({"tag_name": tag, "body": NOTES, "html_url": f"https://example.com/{tag}"}, f)
    sums = os.path.join(root, tag, "SHA256SUMS")

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=root))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    env = dict(os.environ, TITL_UPDATE_URL=f"{base}/latest.json", TITL_RELEASE_URL=base)
    cache = os.path.join(data_dir, "update.json")
    if os.path.exists(cache):
        os.remove(cache)

    reply = ask(installed, {"cmd": "checkUpdate"}, env)
    assert reply["status"] == "update", reply
    assert reply["latest"] == new_version, reply
    assert reply["notes"] == ["Fixed: Updater works on Windows.", "Added: A new thing."], reply
    assert reply["url"] == f"https://example.com/{tag}", reply

    with open(sums, "w") as f:
        f.write(f"{'0' * 64}  {ASSET}\n")
    reply = ask(installed, {"cmd": "update"}, env)
    assert reply["status"] == "error" and "checksum mismatch" in reply["error"], reply
    assert version(installed) == old_version, "a failed update must leave the installed helper alone"
    assert not os.path.exists(os.path.join(data_dir, "titl.new.exe")), "the rejected download must be removed"

    with open(fresh, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    with open(sums, "w") as f:
        f.write(f"{digest}  {ASSET}\n")
    reply = ask(installed, {"cmd": "update"}, env)
    assert reply == {"status": "updated", "version": new_version}, reply
    assert version(installed) == f"titl {new_version}", version(installed)
    leftovers = glob.glob(os.path.join(data_dir, "titl.old-*.exe"))
    assert leftovers, "the previous helper should be kept aside until the next start"

    reply = ask(installed, {"cmd": "checkUpdate"}, env)
    assert reply["status"] == "current" and reply["current"] == new_version, reply
    assert not glob.glob(os.path.join(data_dir, "titl.old-*.exe")), "the next start should delete the previous helper"

    server.shutdown()
    print(f"updated {old_version} -> titl {new_version}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
