"""Prepare one version per triggering commit; reruns reuse the recorded release."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from datetime import date


def prepare(source, bump):
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise ValueError("Release source must be a full commit SHA")
    subprocess.run(["git", "cat-file", "-e", source + "^{commit}"], check=True)
    marker = "Release-Source: " + source
    commits = subprocess.check_output(["git", "log", "--format=%H", "--fixed-strings", "--grep", marker], text=True).splitlines()
    reused = False
    for commit in commits:
        message = subprocess.check_output(["git", "show", "-s", "--format=%B", commit], text=True)
        if marker in message.splitlines():
            subprocess.run(["git", "checkout", "--detach", commit], check=True)
            reused = True
            break
    package_path = Path("package.json")
    package = json.loads(package_path.read_text())
    if not reused:
        if not re.fullmatch(r"\d+\.\d+\.\d+", package["version"]):
            raise ValueError("Automatic releases require a stable major.minor.patch version")
        parts = list(map(int, package["version"].split(".")))
        index = {"major": 0, "minor": 1, "patch": 2}[bump]
        parts[index] += 1
        for following in range(index + 1, 3):
            parts[following] = 0
        package["version"] = ".".join(map(str, parts))
        package_path.write_text(json.dumps(package, indent=2) + "\n")
        lock_path = Path("package-lock.json")
        lock = json.loads(lock_path.read_text())
        lock["version"] = package["version"]
        lock["packages"][""]["version"] = package["version"]
        lock_path.write_text(json.dumps(lock, indent=2) + "\n")
        changelog = Path("CHANGELOG.md")
        text = changelog.read_text()
        heading, rest = text.split("\n", 1)
        changelog.write_text(f"{heading}\n\n## {package['version']} ({date.today()})\n\n- 自动发布，源提交 `{source[:7]}`；具体变更见 GitHub Release。\n" + rest)
    outputs = {"version": package["version"], "reused": str(reused).lower()}
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as file:
            for key, value in outputs.items():
                file.write(f"{key}={value}\n")
    print(json.dumps(outputs))
    return outputs


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--bump", choices=["patch", "minor", "major"], default="patch")
    args = parser.parse_args()
    prepare(args.source, args.bump)
