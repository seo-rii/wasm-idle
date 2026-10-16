import importlib.util
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    "clang_sources", Path(__file__).with_name("prepare-container-clang-source-pack.py"))
sources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sources)


class GitSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Source fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        (self.repo / "llvm").mkdir()
        (self.repo / "llvm" / "source.c").write_text("int source = 1;\n")
        (self.repo / "run.sh").write_text("#!/bin/sh\nexit 0\n")
        (self.repo / "run.sh").chmod(0o755)
        (self.repo / "link").symlink_to("llvm/source.c")
        (self.repo / "LICENSE.TXT").write_text("Fixture source license\n")
        self.commit()

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.PIPE)

    def commit(self):
        self.git("add", "--all")
        self.git("commit", "-qm", "fixture")
        self.revision = self.git("rev-parse", "HEAD").decode().strip()

    def archive(self, target, paths=()):
        records = sources.tree(self.repo, self.revision, paths)
        return sources.archive_tree(self.repo, self.revision, "source", records, target, paths)

    def test_exact_commit_ignores_dirty_index_and_worktree(self):
        before = self.archive(self.root / "before.tar.gz")
        (self.repo / "llvm" / "source.c").write_text("changed\n")
        self.git("add", "llvm/source.c")
        (self.repo / "untracked.c").write_text("untracked\n")
        after = self.archive(self.root / "after.tar.gz")
        self.assertEqual(before["sha256"], after["sha256"])
        self.assertEqual(before["files"], 4)
        with tarfile.open(self.root / "after.tar.gz") as result:
            self.assertEqual(result.extractfile("source/llvm/source.c").read(), b"int source = 1;\n")
            self.assertEqual(result.getmember("source/run.sh").mode, 0o755)
            self.assertEqual(result.getmember("source/link").linkname, "llvm/source.c")
            self.assertEqual(result.getmember("source/run.sh").mtime, 0)

    def test_project_partitions_preserve_complete_disjoint_tree(self):
        all_files = set(sources.tree(self.repo, self.revision))
        first = set(sources.tree(self.repo, self.revision, ["llvm"]))
        second = set(sources.tree(self.repo, self.revision, ["LICENSE.TXT", "link", "run.sh"]))
        self.assertEqual(first | second, all_files)
        self.assertFalse(first & second)
        self.assertEqual(self.archive(self.root / "llvm.tar.gz", ["llvm"])["files"], 1)

    def test_export_attributes_cannot_omit_or_rewrite_pinned_sources(self):
        (self.repo / ".gitattributes").write_text("llvm/source.c export-ignore\nrun.sh export-subst\n")
        (self.repo / "run.sh").write_text("$Format:%H$\n")
        self.commit()
        record = self.archive(self.root / "complete.tar.gz")
        self.assertEqual(record["files"], 5)
        with tarfile.open(self.root / "complete.tar.gz") as result:
            self.assertEqual(result.extractfile("source/llvm/source.c").read(), b"int source = 1;\n")
            self.assertEqual(result.extractfile("source/run.sh").read(), b"$Format:%H$\n")

    def test_gitlinks_fail_as_missing_material(self):
        self.git("update-index", "--add", "--cacheinfo", "160000", self.revision, "submodule")
        self.git("commit", "-qm", "gitlink fixture")
        revision = self.git("rev-parse", "HEAD").decode().strip()
        with self.assertRaisesRegex(ValueError, "gitlink"):
            sources.tree(self.repo, revision)

    def test_streamed_archive_enforces_compressed_bound(self):
        records = sources.tree(self.repo, self.revision)
        with self.assertRaisesRegex(ValueError, "byte limit"):
            sources.archive_tree(self.repo, self.revision, "source", records,
                                 self.root / "bounded.tar.gz", max_bytes=1)

    def test_candidate_inventory_is_exact_and_independently_pinned(self):
        candidate = self.root / "candidate"
        (candidate / "source-pack").mkdir(parents=True)
        (candidate / "source-pack" / "patch.diff").write_bytes(b"source patch\n")
        for name in ["clang.wasm", "lld.wasm"]:
            (candidate / name).write_bytes(b"wasm fixture bytes")
        receipt = {"complete": True, "readOnlyInputsUnchanged": True,
                   "sourcePack": {"patch.diff": sources.source.identity(candidate / "source-pack/patch.diff")},
                   "outputs": {name: sources.source.identity(candidate / name)
                               for name in ["clang.wasm", "lld.wasm"]}}
        (candidate / "build-receipt.json").write_text(json.dumps(receipt))
        expected = sources.source.identity(candidate / "build-receipt.json")["sha256"]
        self.assertEqual(sources.candidate_materials(candidate, expected, sources.source.Materials()), receipt)
        with self.assertRaisesRegex(ValueError, "digest mismatch"):
            sources.candidate_materials(candidate, "0" * 64, sources.source.Materials())
        (candidate / "source-pack/unlisted.c").write_text("extra")
        with self.assertRaisesRegex(ValueError, "inventory differs"):
            sources.candidate_materials(candidate, expected, sources.source.Materials())


if __name__ == "__main__":
    unittest.main()
