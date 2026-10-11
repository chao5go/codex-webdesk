"""Ship the same prebuilt Node runtime in Python wheels and source distributions."""
import json
from pathlib import Path
import shutil
from setuptools import setup
from setuptools.command.build_py import build_py

ROOT = Path(__file__).parent

class BuildRuntime(build_py):
    def run(self):
        if not (ROOT / "dist/app.js").is_file():
            raise RuntimeError("Build frontend first: npm ci && npm run build")
        super().run()
        target = Path(self.build_lib) / "codex_webdesk" / "runtime"
        for folder in ("bin", "src", "dist", "examples"):
            shutil.copytree(ROOT / folder, target / folder, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        for name in ("package.json", "LICENSE", "config.example.json"):
            shutil.copy2(ROOT / name, target / name)

setup(version=json.loads((ROOT / "package.json").read_text())["version"],
      cmdclass={"build_py": BuildRuntime})
