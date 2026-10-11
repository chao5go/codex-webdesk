"""Publish tested artifacts and verify visibility; support partially completed reruns."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import tempfile
import urllib.request
import urllib.error


def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Cache-Control": "no-cache"}), timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def wait_for(url, ready, seconds=1200):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            data = get(url)
            if data and ready(data):
                return data
        except (OSError, urllib.error.URLError) as error:
            print(f"Registry temporarily unavailable: {type(error).__name__}", flush=True)
        print("Waiting for registry visibility (do not republish)...", flush=True)
        time.sleep(20)
    raise RuntimeError("Registry visibility timed out; check scan/staging status, then rerun failed jobs")


def verify_command(command, seconds=360, cwd=None):
    """Package JSON and install indexes can become visible at different times."""
    deadline = time.monotonic() + seconds
    while True:
        result = subprocess.run(command, text=True, capture_output=True, cwd=cwd)
        if result.returncode == 0:
            print(result.stdout.strip(), flush=True)
            return
        if time.monotonic() >= deadline:
            raise RuntimeError("Published-package install verification failed: " + result.stderr)
        print("Waiting for install index propagation (no additional upload)...", flush=True)
        time.sleep(20)


def publish(channel, version, folder):
    if channel == "npm":
        archive = (folder / f"codex-webdesk-{version}.tgz").resolve()
        url = f"https://registry.npmjs.org/codex-webdesk/{version}"
        existing = get(url)
        if not existing:
            subprocess.run(["npm", "publish", str(archive), "--registry=https://registry.npmjs.org", "--access=public"], check=True)
        data = existing or wait_for(url, lambda value: value.get("version") == version)
        if data["dist"]["shasum"] != hashlib.sha1(archive.read_bytes()).hexdigest():
            raise RuntimeError("Published npm artifact differs from this release")
        # Use a fresh cache so a pre-scan negative response cannot hide the release.
        # npm exec inside this same-name checkout can select the uninstalled local
        # package instead of the registry package. Verify from an isolated cwd.
        with tempfile.TemporaryDirectory(prefix="webdesk-npm-verify-") as directory:
            verify_command(["npm", "exec", "--yes", "--prefer-online", "--registry=https://registry.npmjs.org",
                            "--cache", str(Path(directory) / "cache"),
                            f"--package=codex-webdesk@{version}", "--", "codex-webdesk", "--version"], cwd=directory)
    else:
        files = [folder / f"codex_webdesk-{version}{suffix}" for suffix in ("-py3-none-any.whl", ".tar.gz")]
        url = f"https://pypi.org/pypi/codex-webdesk/{version}/json"
        existing = get(url)
        published_names = {item["filename"] for item in (existing or {}).get("urls", [])}
        missing = [file for file in files if file.name not in published_names]
        if missing:
            subprocess.run(["uv", "publish", "--check-url", "https://pypi.org/simple", *map(str, missing)], check=True)
        data = wait_for(url, lambda value: {p.name for p in files}.issubset({item["filename"] for item in value["urls"]}))
        # Fresh builds can contain different timestamps, so preserve original artifacts
        # when rerunning just the publish jobs; never overwrite registry files.
        for item in data["urls"]:
            artifact = folder / item["filename"]
            if artifact.is_file() and item["digests"]["sha256"] != hashlib.sha256(artifact.read_bytes()).hexdigest():
                raise RuntimeError("Published PyPI artifact differs; rerun failed publish jobs with original build artifacts")
        verify_command(["uvx", "--refresh", "--index-url", "https://pypi.org/simple", f"codex-webdesk@{version}", "--version"])
    print(f"{channel} {version} verified", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("channel", choices=["npm", "pypi"])
    parser.add_argument("--version", required=True)
    parser.add_argument("--folder", type=Path, default=Path("release-artifacts"))
    args = parser.parse_args()
    publish(args.channel, args.version, args.folder)
