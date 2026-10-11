"""Release invariants: synced versions, rerun identity and partial publish recovery."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent

def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

prepare = load("prepare-release")
registry = load("registry-release")

class ReleaseTests(unittest.TestCase):
    def repository(self, root):
        def git(*args):
            return subprocess.check_output(["git", *args], cwd=root, text=True, stderr=subprocess.DEVNULL).strip()
        git("init", "-b", "main")
        git("config", "user.name", "Test")
        git("config", "user.email", "test@example.com")
        (root / "package.json").write_text(json.dumps({"name":"codex-webdesk", "version":"0.1.2"}))
        (root / "package-lock.json").write_text(json.dumps({"version":"0.1.2", "packages":{"":{"version":"0.1.2"}}}))
        (root / "CHANGELOG.md").write_text("# Changelog\n\n## 0.1.2\n")
        git("add", ".")
        git("commit", "-m", "Source")
        return git, git("rev-parse", "HEAD")

    def test_version_and_lock_remain_synced_for_all_increments(self):
        for bump, expected in [("patch","0.1.3"), ("minor","0.2.0"), ("major","1.0.0")]:
            with self.subTest(bump=bump), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                _, source = self.repository(root)
                result = subprocess.check_output(["python3", str(ROOT / "scripts/prepare-release.py"), "--source", source, "--bump", bump], cwd=root, text=True)
                self.assertEqual(json.loads(result)["version"], expected)
                lock = json.loads((root / "package-lock.json").read_text())
                self.assertEqual(lock["version"], expected)
                self.assertEqual(lock["packages"][""]["version"], expected)
                self.assertIn("## " + expected, (root / "CHANGELOG.md").read_text())

    def test_rerun_reuses_original_release_even_after_another_source_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            git, source = self.repository(root)
            command = ["python3", str(ROOT / "scripts/prepare-release.py"), "--source", source]
            subprocess.check_call(command, cwd=root, stdout=subprocess.DEVNULL)
            git("add", ".")
            git("commit", "-m", "Release", "-m", "Release-Source: " + source)
            release = git("rev-parse", "HEAD")
            (root / "extra.txt").write_text("Unreleased work")
            git("add", ".")
            git("commit", "-m", "Another source")
            result = json.loads(subprocess.check_output(command, cwd=root, text=True, stderr=subprocess.DEVNULL))
            self.assertEqual(result, {"version":"0.1.3", "reused":"true"})
            self.assertEqual(git("rev-parse", "HEAD"), release)

    def test_npm_existing_version_is_verified_without_republishing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / "codex-webdesk-0.1.3.tgz"
            archive.write_bytes(b"original tested artifact")
            metadata = {"version":"0.1.3", "dist":{"shasum":hashlib.sha1(archive.read_bytes()).hexdigest()}}
            with patch.object(registry, "get", return_value=metadata), patch.object(registry.subprocess, "run") as run:
                registry.publish("npm", "0.1.3", root)
                self.assertEqual(run.call_count, 1)
                self.assertEqual(run.call_args.args[0][1], "exec")
            metadata["dist"]["shasum"] = "wrong"
            with patch.object(registry, "get", return_value=metadata), patch.object(registry.subprocess, "run") as run:
                with self.assertRaises(RuntimeError): registry.publish("npm", "0.1.3", root)
                run.assert_not_called()

    def test_pypi_partial_release_only_uploads_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = [root / ("codex_webdesk-0.1.3" + suffix) for suffix in ("-py3-none-any.whl", ".tar.gz")]
            for file in files: file.write_bytes(file.name.encode())
            entries = [{"filename":f.name, "digests":{"sha256":hashlib.sha256(f.read_bytes()).hexdigest()}} for f in files]
            with patch.object(registry, "get", return_value={"urls":entries[:1]}), patch.object(registry, "wait_for", return_value={"urls":entries}), patch.object(registry.subprocess, "run") as run:
                registry.publish("pypi", "0.1.3", root)
                upload = run.call_args_list[0].args[0]
                self.assertIn(str(files[1]), upload)
                self.assertNotIn(str(files[0]), upload)

if __name__ == "__main__":
    unittest.main()
