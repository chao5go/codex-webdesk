"""Exercise an installed Python distribution without real Codex data/model calls."""
import importlib.metadata
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error

version = importlib.metadata.version("codex-webdesk")
assert subprocess.check_output([sys.executable, "-m", "codex_webdesk", "--version"], text=True).strip() == version
with tempfile.TemporaryDirectory(prefix="webdesk-python-") as tmp:
    root = Path(tmp)
    home = root / "codex"
    (home / "sessions").mkdir(parents=True)
    session_id = "77777777-7777-4777-8777-777777777777"
    (home / "sessions" / "demo.jsonl").write_text("\n".join(json.dumps(row) for row in [
        {"type": "session_meta", "payload": {"id": session_id, "cwd": tmp}},
        {"type": "event_msg", "payload": {"type": "user_message", "message": "Python distribution test"}},
    ]))
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    token = "python-package-test-token"
    process = subprocess.Popen([sys.executable, "-m", "codex_webdesk", "start", "--port", str(port),
        "--cwd", tmp, "--data-dir", str(root / "data"), "--codex-home", str(home),
        "--plugins-dir", str(root / "plugins"), "--token", token], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    base = f"http://127.0.0.1:{port}"
    def request(route, payload=None, extra=None):
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", **(extra or {})}
        return urllib.request.urlopen(urllib.request.Request(base + route,
            data=json.dumps(payload).encode() if payload is not None else None, headers=headers), timeout=5)
    try:
        for attempt in range(100):
            if process.poll() is not None:
                raise AssertionError(process.communicate())
            try:
                with urllib.request.urlopen(base, timeout=1) as response:
                    assert response.status == 200
                break
            except (OSError, urllib.error.URLError):
                time.sleep(0.05)
        else:
            raise AssertionError("Server startup timed out")
        try:
            urllib.request.urlopen(base + "/api/config")
            raise AssertionError("Unauthenticated API access succeeded")
        except urllib.error.HTTPError as error:
            assert error.code == 401
        with request("/api/config") as response:
            assert json.load(response)["version"] == version
        with request("/api/plugins") as response:
            plugins = json.load(response)["plugins"]
            assert next(p for p in plugins if p["id"] == "codex-history")["available"]
        with request("/api/plugins/codex-history/api/sessions") as response:
            sessions = json.load(response)
            assert len(sessions["sessions"]) == 1
        with request("/api/plugins/codex-history/api/sessions/export",
                     {"ids": [session_id], "format": "html"},
                     {"X-CSRF-Token": sessions["csrfToken"]}) as response:
            assert b"Python distribution test" in response.read()
    finally:
        process.terminate()
        try:
            stdout, stderr = process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise AssertionError("Service did not shut down on SIGTERM")
        assert process.returncode == 0, stderr
print("Python installed package passed: version, assets, auth, session adapter, export and SIGTERM.")
