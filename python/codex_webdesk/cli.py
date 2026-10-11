"""Launch the packaged Node service without changing the user's working directory."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

def main():
    node = shutil.which("node")
    if node is None:
        sys.exit("Codex Webdesk requires Node.js 22+. Install Node.js and retry.")
    try:
        major = int(subprocess.check_output([node, "--version"], text=True).strip().lstrip("v").split(".")[0])
        if major < 22:
            sys.exit("Codex Webdesk requires Node.js 22+.")
    except (OSError, ValueError, subprocess.CalledProcessError):
        sys.exit("Could not determine Node.js version; Node.js 22+ is required.")
    entry = Path(__file__).parent / "runtime" / "bin" / "cli.js"
    if not entry.is_file():
        sys.exit("Packaged runtime missing. Reinstall codex-webdesk from PyPI.")
    env = dict(os.environ, CODEX_WEBDESK_PYTHON=sys.executable)
    # POSIX exec preserves signals and exit status, including service shutdown.
    os.execve(node, [node, str(entry), *sys.argv[1:]], env)
