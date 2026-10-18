import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("source_pack", Path(__file__).with_name("prepare-container-source-pack.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def archive(path, files):
    with tarfile.open(path, "w:gz") as stream:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            stream.addfile(info, io.BytesIO(data))


class SourcePackTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_archive_order_timestamps_and_host_names_do_not_change_pack(self):
        first, second = module.Materials(), module.Materials()
        first.add("b", b"two")
        first.add("a", b"one")
        second.add("a", b"one")
        second.add("b", b"two")
        first.write_tar(self.root / "first.gz")
        second.write_tar(self.root / "different-name.gz")
        self.assertEqual((self.root / "first.gz").read_bytes(), (self.root / "different-name.gz").read_bytes())
        with tarfile.open(self.root / "first.gz") as result:
            self.assertEqual(result.getnames(), ["a", "b"])
            self.assertTrue(all(item.mtime == 0 and item.uid == 0 and item.gid == 0 for item in result))

    def test_changed_source_fails_while_streaming_archive(self):
        source = self.root / "source"
        source.write_bytes(b"first")
        materials = module.Materials()
        materials.add("source", source)
        source.write_bytes(b"other")
        with self.assertRaisesRegex(ValueError, "changed while packaging"):
            materials.write_tar(self.root / "result.gz")

    def test_source_subset_preserves_whole_requested_trees_and_parent_identity(self):
        source = self.root / "upstream.tar.gz"
        archive(source, {"upstream/compiler-rt/lib/builtins.c": b"code", "upstream/compiler-rt/LICENSE": b"license",
                         "upstream/compiler-rt-other/unrelated": b"excluded", "upstream/LICENSE": b"root notice"})
        result = self.root / "subset.tar.gz"
        receipt = module.source_subset(source, module.identity(source), "upstream", ["compiler-rt"], ["LICENSE"], result)
        self.assertEqual(receipt["entries"], 3)
        with tarfile.open(result) as packed:
            self.assertNotIn("upstream/compiler-rt-other/unrelated", packed.getnames())
            provenance = json.load(packed.extractfile("SOURCE-SUBSET.json"))
            self.assertEqual(provenance["parentArchive"], module.identity(source))

    def test_pinned_json_requires_independent_digest(self):
        path = self.root / "receipt.json"
        path.write_text('{"complete": true}')
        with self.assertRaisesRegex(ValueError, "independent digest"):
            module.pinned_json(path, "0" * 64)

    def test_paths_cannot_leave_material_namespace(self):
        for name in ("/absolute", "../outside", "a/../outside", "a//b", "a\\b", ".", "x\0y"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                module.Materials().add(name, b"bytes")

    def test_registry_checksum_required_and_shared_lock_entry_deduplicated(self):
        path = self.root / "example-1.0.0.crate"
        archive(path, {"example-1.0.0/Cargo.toml": b'[package]\nname="example"\nversion="1.0.0"\nlicense="MIT"\n',
                       "example-1.0.0/LICENSE": b"original license text"})
        package = {"name": "example", "version": "1.0.0", "source": module.CRATES_IO, "checksum": "0" * 64}
        materials, records = module.Materials(), {}
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            module.registry_materials({"package": [package]}, self.root, materials, records, "sdk")
        package["checksum"] = module.identity(path)["sha256"]
        module.registry_materials({"package": [package]}, self.root, materials, records, "sdk")
        module.registry_materials({"package": [package]}, self.root, materials, records, "std")
        self.assertEqual(len(records), 1)
        self.assertEqual(records["example-1.0.0"]["locks"], ["sdk", "std"])
        self.assertEqual(records["example-1.0.0"]["notices"], ["notices/example-1.0.0/LICENSE"])

    def test_declared_license_does_not_fabricate_missing_notice(self):
        path = self.root / "crate.tar.gz"
        archive(path, {"crate/Cargo.toml": b'[package]\nname="crate"\nlicense="MIT"\n'})
        record = module.scan_archive(path, "crate", module.Materials(), "crate")
        self.assertEqual(record["declaredLicense"], "MIT")
        self.assertEqual(record["notices"], [])

    def test_license_directories_and_explicit_filenames_are_preserved(self):
        path = self.root / "crate.tar.gz"
        archive(path, {"crate/terms.txt": b"terms", "crate/LICENSES/MIT.txt": b"MIT text",
                       "crate/Cargo.toml": b'[package]\nname="crate"\nlicense-file="terms.txt"\n'})
        record = module.scan_archive(path, "crate", module.Materials(), "crate")
        self.assertEqual(record["notices"], ["notices/crate/LICENSES/MIT.txt", "notices/crate/terms.txt"])

    def test_upstream_workspace_manifest_has_no_package_license(self):
        path = self.root / "workspace.tar.gz"
        archive(path, {"root/Cargo.toml": b'[workspace]\nmembers=["child"]\n', "root/LICENSE": b"notice"})
        record = module.scan_archive(path, "root", module.Materials(), "workspace")
        self.assertIsNone(record["declaredLicense"])
        self.assertEqual(record["notices"], ["notices/workspace/LICENSE"])

    def test_prepared_source_inventory_rejects_missing_and_unlisted_files(self):
        pins = {}
        for name in module.TREES:
            root = self.root / name
            root.mkdir()
            path = root / "Cargo.toml"
            path.write_bytes(b"original")
            pins[str(path)] = module.identity(path)
        receipt = self.root / "receipt.json"
        receipt.write_text("{}")
        pins[str(receipt)] = module.identity(receipt)
        policy = {"preparedSource": str(self.root), "sourceTrees": sorted(module.TREES), "sourcePins": pins}
        module.copy_prepared(policy, module.Materials())
        extra = self.root / "virtual-fs/extra.rs"
        extra.write_bytes(b"unlisted")
        with self.assertRaisesRegex(ValueError, "unlisted prepared"):
            module.copy_prepared(policy, module.Materials())
        extra.unlink()
        (self.root / "virtual-fs/Cargo.toml").unlink()
        with self.assertRaisesRegex(ValueError, "inventory mismatch"):
            module.copy_prepared(policy, module.Materials())

    def test_rust_component_must_match_installed_sources(self):
        root = self.root / "installed"
        (root / "library").mkdir(parents=True)
        lock = b'version=3\npackage=[]\n'
        (root / "library/Cargo.lock").write_bytes(lock)
        (root / "library/source.rs").write_bytes(b"exact")
        path = self.root / "rust-src.tar.gz"
        archive(path, {"component/source/library/Cargo.lock": lock,
                       "component/source/library/source.rs": b"exact"})
        config = {"archive": "rust", "prefix": "component/source", "installedRoot": str(root)}
        inputs = {"rust": {"path": path, "identity": module.identity(path)}}
        result = module.rust_materials(config, inputs, module.Materials(), self.root, {})
        self.assertEqual(result["verifiedInstalledFiles"], 2)
        (root / "library/source.rs").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "differs from component"):
            module.rust_materials(config, inputs, module.Materials(), self.root, {})

    def test_upstream_notice_requires_every_published_source_file_to_match(self):
        crate, upstream = self.root / "crate.gz", self.root / "upstream.gz"
        archive(crate, {"crate-1/Cargo.toml": b"normalized", "crate-1/Cargo.lock": b"generated",
                        "crate-1/Cargo.toml.orig": b"original", "crate-1/src/lib.rs": b"code"})
        archive(upstream, {"root/subcrate/Cargo.toml": b"original", "root/subcrate/src/lib.rs": b"code"})
        self.assertEqual(module.match_published_source(crate, upstream, "root/subcrate"), ["Cargo.toml.orig", "src/lib.rs"])
        archive(upstream, {"root/subcrate/Cargo.toml": b"original", "root/subcrate/src/lib.rs": b"evil"})
        with self.assertRaisesRegex(ValueError, "source bytes mismatch"):
            module.match_published_source(crate, upstream, "root/subcrate")


if __name__ == "__main__":
    unittest.main()
