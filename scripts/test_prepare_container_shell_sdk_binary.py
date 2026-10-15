"""Bounded admission/ownership tests. These do not build or qualify the SDK."""

import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("sdk_build_prepare", SCRIPTS / "prepare-container-shell-sdk-binary.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        for name in ("wasmer-sdk", "wasmer-wasix"):
            (self.source / name).mkdir(parents=True)
            (self.source / name / "source.rs").write_text("original source\n")
        (self.source / "wasmer-sdk/.cargo").mkdir()
        (self.source / "wasmer-sdk/.cargo/config.toml").write_text("[build]\ntarget = \"wasm32-unknown-unknown\"\n")
        argv = ["/trusted/cargo", "+nightly-2025-07-05", "check", "--locked", "--offline", "--target",
                "wasm32-unknown-unknown", "--lib", "--example", "container_command_snapshot_compile", "-j", "1"]
        self.policy = {"preparedSource": str(self.source), "sourcePins": {
            str(path): builder.identity(path) for path in self.source.rglob("*") if path.is_file()},
            "stage": {"argv": argv, "producerWorktree": str(self.source / "wasmer-sdk"),
                      "environment": {"CARGO_HOME": str(self.root / "cargo-home")}}}
        self.check = {"argv": argv, "exitCode": 0, "termination": "exited", "cleanup": {
            "allReaped": True, "signaled": [], "remaining": [], "errors": []}}
        self.policy_path, self.check_path = self.root / "policy.json", self.root / "check.json"
        self.policy_path.write_text(json.dumps(self.policy))
        self.check_path.write_text(json.dumps(self.check))
        self.options = SimpleNamespace(source_policy=self.policy_path,
                                       source_policy_sha256=builder.identity(self.policy_path)["sha256"],
                                       typecheck_receipt=self.check_path,
                                       typecheck_receipt_sha256=builder.identity(self.check_path)["sha256"],
                                       output=self.root / "output")

    def tearDown(self):
        self.temporary.cleanup()

    def rejected_without_tool_or_output(self, reason=""):
        with patch.object(builder.subprocess, "check_output", side_effect=AssertionError("tool must not run")) as tool:
            with self.assertRaisesRegex(ValueError, reason):
                builder.prepare(self.options)
            tool.assert_not_called()
        self.assertFalse(self.options.output.exists())

    def test_independent_policy_digest_before_tool_or_output(self):
        self.options.source_policy_sha256 = "0" * 64
        self.rejected_without_tool_or_output()

    def test_failed_actual_check_before_tool_or_output(self):
        self.check["exitCode"] = 101
        self.check_path.write_text(json.dumps(self.check))
        self.options.typecheck_receipt_sha256 = builder.identity(self.check_path)["sha256"]
        self.rejected_without_tool_or_output()

    def test_modified_source_pin_before_tool_or_output(self):
        (self.source / "wasmer-wasix/source.rs").write_text("changed source\n")
        self.rejected_without_tool_or_output()

    def test_unlisted_source_before_tool_or_output(self):
        (self.source / "wasmer-sdk/build.rs").write_text("unlisted build input\n")
        self.rejected_without_tool_or_output()

    def test_successful_check_with_orphan_cleanup_rejected(self):
        self.check["cleanup"]["signaled"] = [{"pid": 123}]
        self.check_path.write_text(json.dumps(self.check))
        self.options.typecheck_receipt_sha256 = builder.identity(self.check_path)["sha256"]
        self.rejected_without_tool_or_output()

    def test_unpinned_cargo_configuration_before_tool_or_output(self):
        # Cargo reads these locations, but neither is inside an inventoried source tree.
        for directory in (self.source / ".cargo", self.root / "cargo-home"):
            with self.subTest(directory=directory):
                directory.mkdir(parents=True, exist_ok=True)
                (directory / "config.toml").write_text("[build]\nrustflags = [\"-Cdebuginfo=2\"]\n")
                self.rejected_without_tool_or_output("unpinned Cargo configuration")
                (directory / "config.toml").unlink()

    def test_pinned_sdk_cargo_configuration_is_accepted(self):
        self.assertEqual(builder.verify_source(self.policy), self.source.resolve())

    @unittest.skipUnless(sys.platform == "linux", "Linux process owner")
    def test_prepared_plan_pins_compiler_libraries_and_linker(self):
        toolchain = self.root / "rustup/toolchains/nightly-2025-07-05-x86_64-unknown-linux-gnu"
        linker = toolchain / "lib/rustlib/x86_64-unknown-linux-gnu/bin/rust-lld"
        linker.parent.mkdir(parents=True)
        (toolchain / "bin").mkdir()
        for path in (toolchain / "bin/cargo", toolchain / "bin/rustc", toolchain / "lib/librustc_driver-test.so", linker):
            path.write_text(path.name + "\n")
        for name in ("cargo", "rustc"):
            self.policy["sourcePins"][str(toolchain / "bin" / name)] = builder.identity(toolchain / "bin" / name)
        (self.source / "receipt.json").write_text(json.dumps({"sdkSourceRevision": builder.SDK_REVISION}))
        self.policy["stage"]["environment"]["RUSTUP_HOME"] = str(self.root / "rustup")
        self.policy["sourceCommit"] = "0" * 40
        self.policy_path.write_text(json.dumps(self.policy))
        bindgen, node = self.root / "wasm-bindgen", self.root / "node"
        bindgen.write_text("#!/bin/sh\necho 'wasm-bindgen 0.2.101'\n")
        bindgen.chmod(0o700)
        node.write_text("node\n")
        self.options.__dict__.update(
            source_policy_sha256=builder.identity(self.policy_path)["sha256"],
            bindgen=bindgen, bindgen_sha256=builder.identity(bindgen)["sha256"],
            node=node, node_sha256=builder.identity(node)["sha256"],
            log_directory=self.root / "logs", profile="release", reuse_checked_target=False)
        with patch("builtins.print"):
            builder.prepare(self.options)
        recipe, _ = builder.checked_plan(self.options.output)
        for path in (toolchain / "lib/librustc_driver-test.so", linker):
            self.assertIn(str(path), recipe["inputPins"])
        linker.write_text("replaced linker\n")
        with self.assertRaisesRegex(ValueError, "pinned input changed"):
            builder.checked_plan(self.options.output)


@unittest.skipUnless(sys.platform == "linux", "Linux process ownership")
class OwnershipTests(unittest.TestCase):
    def exercise(self, child_source, cancel=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = """
import json,os,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import container_shell_sdk_build_guard as g
os.umask(0o077)
root=Path(sys.argv[2]);g.enable_cleanup()
stage={'name':'probe','argv':[sys.executable,'-c',sys.argv[3]],'log':str(root/'probe.log'),'wallSeconds':10}
limits={'cpuSoftSeconds':10,'cpuHardSeconds':11,'addressSpaceBytes':1024**3,'minimumRemainingDiskBytes':0}
try:g.run_stage(root,stage,os.environ.copy(),root,limits)
except RuntimeError as error:(root/'error.txt').write_text(str(error))
"""
            owner = subprocess.Popen([sys.executable, "-c", payload, str(SCRIPTS), str(root), child_source],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            if cancel:
                deadline = time.monotonic() + 5
                while not (root / "phase.json").exists() and owner.poll() is None:
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(0.01)
                owner.send_signal(signal.SIGTERM)
            _, errors = owner.communicate(timeout=15)
            self.assertEqual(owner.returncode, 0, errors.decode())
            result = json.loads((root / "probe.process.json").read_text())
            self.assertTrue(result["cleanup"]["allReaped"])
            self.assertEqual(result["cleanup"]["remaining"], [])
            self.assertTrue(result["cleanup"]["signaled"])
            self.assertTrue((root / "error.txt").is_file())
            return result

    def test_cancel_recovers_owned_child(self):
        result = self.exercise("import time; time.sleep(30)", cancel=True)
        self.assertEqual(result["supervisorSignal"], signal.SIGTERM)

    def test_zero_exit_with_detached_descendant_is_rejected_and_reaped(self):
        result = self.exercise("import os,time; child=os.fork(); os._exit(0) if child else None; os.setsid(); time.sleep(30)")
        self.assertEqual(result["exitCode"], 0)

    def test_children_created_by_worker_threads_are_observed_and_reaped(self):
        payload = """
import json,os,subprocess,sys,threading
sys.path.insert(0,sys.argv[1])
import container_shell_sdk_build_guard as g
g.enable_cleanup()
ready,release=threading.Event(),threading.Event()
children=[]
def spawn_from_worker():
    children.append(subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'],
        stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
        start_new_session=True))
    ready.set()
    release.wait(5)
thread=threading.Thread(target=spawn_from_worker)
thread.start()
try:
    assert ready.wait(5),'thread did not start its real child'
    child=children[0]
    observed=g.owned_processes()
    assert any(value['pid']==child.pid for value in observed),'worker-thread child was omitted'
    assert len({value['pid'] for value in observed})==len(observed),'duplicate process observation'
    cleanup=g.cleanup(child)
    assert cleanup['allReaped'] and not cleanup['remaining'] and not cleanup['errors']
    assert any(value['pid']==child.pid for value in cleanup['signaled'])
    assert any(value['pid']==child.pid for value in cleanup['reaped'])
    print(json.dumps({'observed':observed,'cleanup':cleanup}))
finally:
    release.set()
    for child in children:
        if child.poll() is None:child.kill()
        child.wait(timeout=3)
    thread.join(timeout=3)
"""
        result = subprocess.run([sys.executable, "-c", payload, str(SCRIPTS)],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["cleanup"]["allReaped"])

    def test_actual_node_shared_memory_inspection_under_address_space_cap(self):
        node = os.environ.get("WASM_IDLE_SDK_INSPECTION_NODE", "node")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            # A real, structurally valid core Wasm with shared min=1/max=2 memory.
            # It has no executable code and is never instantiated.
            wasm = root / "shared.wasm"
            wasm.write_bytes(bytes([0, 97, 115, 109, 1, 0, 0, 0, 5, 4, 1, 3, 1, 2]))
            argv = [node, "--disable-wasm-trap-handler", "--wasm-num-compilation-tasks=1",
                    str(SCRIPTS / "inspect-container-shell-sdk.mjs"), str(wasm), str(wasm), str(root / "inventory.json")]
            payload = """
import json,os,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import container_shell_sdk_build_guard as g
os.umask(0o077);root=Path(sys.argv[2]);g.enable_cleanup()
stage={'name':'inspect','argv':json.loads(sys.argv[3]),'log':str(root/'inspect.log'),'wallSeconds':30}
limits={'cpuSoftSeconds':20,'cpuHardSeconds':21,'addressSpaceBytes':12*1024**3,'minimumRemainingDiskBytes':0}
g.run_stage(root,stage,os.environ.copy(),root,limits)
"""
            result = subprocess.run([sys.executable, "-c", payload, str(SCRIPTS), str(root), json.dumps(argv)],
                                    capture_output=True, timeout=35)
            self.assertEqual(result.returncode, 0, result.stderr.decode() + (root / "inspect.log").read_text())
            receipt = json.loads((root / "inspect.process.json").read_text())
            self.assertEqual(receipt["exitCode"], 0)
            self.assertTrue(receipt["cleanup"]["allReaped"])
            inventory = json.loads((root / "inventory.json").read_text())
            self.assertEqual(inventory["raw"]["memories"], [{"shared": True, "minimumPages": 1, "maximumPages": 2}])


if __name__ == "__main__":
    unittest.main()
