"""Publish already-tested artifacts using local token files; never prints credentials."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("--channel", choices=["npm", "pypi", "all"], default="all")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
version = json.loads((root / "package.json").read_text())["version"]

def token(variable, filename):
    value = os.environ.get(variable) or (Path.home() / filename).read_text().strip()
    if not value or any(char.isspace() for char in value):
        raise SystemExit(f"Invalid credential format in {filename}")
    return value

if args.channel in ("npm", "all"):
    artifact = root / f"codex-webdesk-{version}.tgz"
    if not artifact.is_file():
        raise SystemExit("Run npm run test:package first")
    with tempfile.TemporaryDirectory(prefix="webdesk-npm-auth-") as tmp:
        config = Path(tmp) / "npmrc"
        config.write_text("//registry.npmjs.org/:_authToken=" + token("NODE_AUTH_TOKEN", ".npm_token") + "\n")
        config.chmod(0o600)
        subprocess.run(["npm", "publish", str(artifact), "--registry", "https://registry.npmjs.org", "--access", "public"],
                       cwd=root, env=dict(os.environ, NPM_CONFIG_USERCONFIG=str(config)), check=True)
if args.channel in ("pypi", "all"):
    artifacts = [root / "python-dist" / f"codex_webdesk-{version}{suffix}" for suffix in ("-py3-none-any.whl", ".tar.gz")]
    if not all(p.is_file() for p in artifacts):
        raise SystemExit("Run uv build --out-dir python-dist first")
    uv = shutil.which("uv")
    if uv is None:
        raise SystemExit("Install uv and add it to PATH first")
    subprocess.run([uv, "publish", *map(str, artifacts)], cwd=root,
                   env=dict(os.environ, UV_PUBLISH_TOKEN=token("UV_PUBLISH_TOKEN", ".pypi_token")), check=True)
