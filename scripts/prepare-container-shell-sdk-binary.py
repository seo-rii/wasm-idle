#!/usr/bin/env python3
"""Prepare, check, or explicitly launch one pinned offline SDK Wasm/bindgen gate.

Preparation never installs a tool, fetches dependencies, builds Rust, or runs a guest.
The launched attempt produces experimental raw Wasm and web glue, not a supported SDK.
"""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time

import container_shell_sdk_build_guard as guard


NIGHTLY = "nightly-2025-07-05"
SDK_REVISION = "93b8b738ebd3ee57e118da0f0eb795b97d5b999e"
BINDGEN_VERSION = "wasm-bindgen 0.2.101"


def identity(path):
    path = Path(path)
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            guard.check_stop()
            digest.update(chunk)
    return {"bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def pinned_json(path, expected):
    if identity(path)["sha256"] != expected:
        raise ValueError(f"independent input digest mismatch: {path}")
    return json.loads(Path(path).read_text())


def verify_pins(pins):
    for name, expected in pins.items():
        path = Path(name)
        if path.is_symlink() or identity(path) != expected:
            raise ValueError(f"pinned input changed: {name}")


def verify_source(policy):
    verify_pins(policy["sourcePins"])
    prepared = Path(policy["preparedSource"]).resolve()
    trees = policy.get("sourceTrees", ["wasmer-sdk", "wasmer-wasix"])
    if (not isinstance(trees, list) or any(not isinstance(name, str) for name in trees)
            or len(set(trees)) != len(trees)
            or not {"wasmer-sdk", "wasmer-wasix"}.issubset(trees)
            or not set(trees).issubset({"wasmer-sdk", "wasmer-wasix", "virtual-fs"})):
        raise ValueError("invalid prepared source tree inventory")
    actual_trees = {path.name for path in prepared.iterdir() if path.is_dir()}
    if actual_trees != set(trees):
        raise ValueError("prepared source tree inventory changed")
    for name in trees:
        root = prepared / name
        if root.is_symlink() or not root.is_dir():
            raise ValueError(f"source tree must be a real directory: {root}")
        actual = set()
        for path in root.rglob("*"):
            if path.is_symlink():
                raise ValueError(f"source symlink rejected: {path}")
            if path.is_file():
                actual.add(str(path.resolve()))
        expected = {name for name in policy["sourcePins"] if name.startswith(str(root) + "/")}
        if actual != expected:
            raise ValueError(f"source inventory changed: {root}")
    return prepared


def validate_typecheck(policy, receipt):
    expected = [policy["stage"]["argv"][0], "+" + NIGHTLY, "check", "--locked", "--offline",
                "--target", "wasm32-unknown-unknown", "--lib", "--example",
                "container_command_snapshot_compile", "-j", "1"]
    if policy["stage"]["argv"] != expected or receipt["argv"] != expected:
        raise ValueError("requires the actual pinned lib/external-example type check")
    if receipt.get("exitCode") != 0 or receipt.get("termination") != "exited":
        raise ValueError("type check did not exit successfully")
    cleanup = receipt.get("cleanup", {})
    if cleanup.get("allReaped") is not True or cleanup.get("signaled") or cleanup.get("remaining") or cleanup.get("errors"):
        raise ValueError("type check cleanup is not complete")


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError(f"requires a private directory: {path}")


def prepare(arguments):
    policy_path = arguments.source_policy.resolve()
    policy = pinned_json(policy_path, arguments.source_policy_sha256)
    check_path = arguments.typecheck_receipt.resolve()
    validate_typecheck(policy, pinned_json(check_path, arguments.typecheck_receipt_sha256))
    prepared = verify_source(policy)
    sdk = prepared / "wasmer-sdk"
    if Path(policy["stage"]["producerWorktree"]).resolve() != sdk:
        raise ValueError("typecheck source path does not match the prepared SDK")
    if json.loads((prepared / "receipt.json").read_text())["sdkSourceRevision"] != SDK_REVISION:
        raise ValueError("SDK source revision differs")
    cargo_home = Path(policy["stage"]["environment"]["CARGO_HOME"]).resolve()
    rustup_home = Path(policy["stage"]["environment"]["RUSTUP_HOME"]).resolve()
    toolchain = rustup_home / "toolchains" / (NIGHTLY + "-x86_64-unknown-linux-gnu")
    cargo, rustc = toolchain / "bin/cargo", toolchain / "bin/rustc"
    for path in (cargo, rustc):
        if str(path) not in policy["sourcePins"]:
            raise ValueError("actual nightly executables must be pinned by the checked source policy")
    bindgen, node = arguments.bindgen.resolve(), arguments.node.resolve()
    for path, digest in ((bindgen, arguments.bindgen_sha256), (node, arguments.node_sha256)):
        if identity(path)["sha256"] != digest:
            raise ValueError(f"tool digest mismatch: {path}")
    if subprocess.check_output([str(bindgen), "--version"], text=True, timeout=5).strip() != BINDGEN_VERSION:
        raise ValueError("wasm-bindgen CLI must match the exact 0.2.101 crate")
    root = arguments.output.resolve()
    if root.exists() or root.is_symlink():
        raise ValueError("output must be a fresh directory")
    if prepared == root or prepared in root.parents or root in prepared.parents:
        raise ValueError("output must be separate from the frozen source tree")
    logs = arguments.log_directory.resolve()
    private_directory(logs)
    if arguments.reuse_checked_target:
        target = Path(policy["stage"]["environment"]["CARGO_TARGET_DIR"]).resolve()
        # The pinned older Cargo may not create a configured intermediate directory.
        # Keep this attempt's intermediate location private even when its target is reused.
        intermediate = root / "sdk-intermediate"
        if not target.is_dir():
            raise ValueError("the same-copy checked target directory is absent")
    else:
        target, intermediate = root / "sdk-target", root / "sdk-intermediate"
    for path in (target, intermediate):
        if prepared == path or prepared in path.parents or path in prepared.parents:
            raise ValueError("build outputs must be outside the immutable source tree")
    environment = {"HOME": str(Path.home()), "PATH": str(toolchain / "bin") + ":/usr/bin:/bin",
                   "RUSTUP_HOME": str(rustup_home), "CARGO_HOME": str(cargo_home),
                   "RUSTC": str(rustc), "CARGO_TARGET_DIR": str(target),
                   "CARGO_BUILD_BUILD_DIR": str(intermediate), "CARGO_BUILD_JOBS": "1",
                   "CARGO_NET_OFFLINE": "true", "RUSTUP_NO_UPDATE_CHECK": "1"}
    if arguments.profile == "dev":
        environment["CARGO_PROFILE_DEV_DEBUG"] = "0"
    raw = root / "artifacts/raw/wasmer_js.wasm"
    web = root / "artifacts/web"
    build = [str(cargo), "build", "--locked", "--offline", "--target", "wasm32-unknown-unknown", "--lib", "-j", "1"]
    if arguments.profile == "release":
        build.append("--release")
    bindgen_argv = [str(bindgen), "--target", "web", "--weak-refs", "--out-dir", str(web), "--out-name", "wasmer_js", str(raw)]
    if arguments.profile == "release":
        # Original wasm-pack metadata sets demangle-name-section=false.
        # Its debug-js-glue=false/dwarf-debug-info=false match CLI defaults.
        bindgen_argv.append("--no-demangle")
    stages = [
        {"name": "sdk-build", "argv": build, "wallSeconds": 3600},
        {"name": "bindgen", "argv": bindgen_argv, "wallSeconds": 600},
        {"name": "inspect", "argv": [str(node), "--disable-wasm-trap-handler", "--wasm-num-compilation-tasks=1", str(root / "inspect.mjs"), str(raw), str(web / "wasmer_js_bg.wasm"), str(root / "wasm-inventory.json")], "wallSeconds": 120}
    ]
    for stage in stages:
        stage["log"] = str(logs / (root.name + "-" + stage["name"] + ".log"))
        if Path(stage["log"]).exists():
            raise ValueError("refuse an existing log; choose a unique attempt name")
    supervisor_log = logs / (root.name + "-supervisor.log")
    if supervisor_log.exists():
        raise ValueError("refuse an existing supervisor log")
    if sys.platform != "linux":
        raise ValueError("this bounded process owner requires Linux /proc and subreaper support")
    root.mkdir(mode=0o700)
    for source, destination in ((Path(__file__), "run.py"), (Path(guard.__file__), "container_shell_sdk_build_guard.py"),
                                (Path(__file__).with_name("inspect-container-shell-sdk.mjs"), "inspect.mjs"),
                                (policy_path, "checked-source-policy.json"), (check_path, "sdk-typecheck.process.json")):
        shutil.copyfile(source, root / destination)
    recipe = {"schemaVersion": 1, "qualification": "Experimental SDK Wasm/web-glue build; no guest, JS command registry, common fd/VFS or shell qualification",
              "sdkSourceRevision": SDK_REVISION, "sourceCommit": policy["sourceCommit"],
              "profile": arguments.profile, "releaseProfilePreserved": arguments.profile == "release",
              "optimization": "No additional wasm-opt or source/lock/profile edits",
              "environment": environment, "workingDirectory": str(sdk), "preparedSource": str(prepared),
              "checkedTargetReusedForSamePhysicalCopy": arguments.reuse_checked_target,
              "cargoOutput": str(target / "wasm32-unknown-unknown" / ("release" if arguments.profile == "release" else "debug") / "wasmer_js.wasm"),
              "bindgenVersion": BINDGEN_VERSION, "stages": stages,
              "inputPins": {str(bindgen): identity(bindgen), str(node): identity(node)},
              "admission": {"minimumAvailableMemoryBytes": 8 * 1024**3, "minimumFreeDiskBytes": 8 * 1024**3},
              "limits": {"cpuSoftSeconds": 3000, "cpuHardSeconds": 3060, "addressSpaceBytes": 12 * 1024**3, "minimumRemainingDiskBytes": 2 * 1024**3},
              "supervisorLog": str(supervisor_log)}
    guard.publish(root / "build-plan.json", recipe)
    guard.publish(root / "prepared-inputs.json", {name: identity(root / name) for name in (
        "run.py", "container_shell_sdk_build_guard.py", "inspect.mjs", "checked-source-policy.json", "sdk-typecheck.process.json", "build-plan.json")})
    print(json.dumps({"prepared": True, "launched": False, "output": str(root), "buildProfile": arguments.profile}))


def checked_plan(root):
    root = root.resolve()
    for name, expected in json.loads((root / "prepared-inputs.json").read_text()).items():
        if Path(name).name != name or identity(root / name) != expected:
            raise ValueError("prepared build recipe changed")
    recipe = json.loads((root / "build-plan.json").read_text())
    verify_pins(recipe["inputPins"])
    policy = json.loads((root / "checked-source-policy.json").read_text())
    verify_source(policy)
    validate_typecheck(policy, json.loads((root / "sdk-typecheck.process.json").read_text()))
    return recipe, policy


def admitted(root, recipe):
    observed = guard.resources(root)
    return (observed["availableMemoryBytes"] >= recipe["admission"]["minimumAvailableMemoryBytes"]
            and observed["freeDiskBytes"] >= recipe["admission"]["minimumFreeDiskBytes"]), observed


def run(root):
    status = 3
    guard.enable_cleanup()
    receipt = {"schemaVersion": 1, "complete": False, "guestQualified": False, "startedAtUnix": time.time()}
    try:
        recipe, policy = checked_plan(root)
        if not (root / "started.json").is_file():
            raise ValueError("start only through --launch")
        if (root / "artifacts").exists():
            raise ValueError("artifact directory already exists")
        allowed, observation = admitted(root, recipe)
        guard.publish(root / "admission.json", observation)
        if not allowed:
            status = 2
            raise ValueError("resource admission failed; no build started")
        (root / "artifacts/raw").mkdir(mode=0o700, parents=True)
        for stage in recipe["stages"]:
            guard.run_stage(root, stage, recipe["environment"], recipe["workingDirectory"], recipe["limits"])
            verify_source(policy)
            verify_pins(recipe["inputPins"])
            if stage["name"] == "sdk-build":
                shutil.copyfile(recipe["cargoOutput"], root / "artifacts/raw/wasmer_js.wasm")
        inventory = json.loads((root / "wasm-inventory.json").read_text())
        source_root = Path(recipe["preparedSource"])
        # Preserve the complete prepared SDK/WASIX source, including the SDK license.
        # Third-party dependency/source notices remain a separate distribution gate.
        with (root / "prepared-source.tar.gz").open("xb") as stream:
            with gzip.GzipFile(filename="", mode="wb", fileobj=stream, mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w|") as archive:
                    for name in sorted(policy["sourcePins"]):
                        guard.check_stop()
                        path = Path(name)
                        if not path.is_relative_to(source_root):
                            continue
                        entry = archive.gettarinfo(str(path), arcname=str(path.relative_to(source_root)))
                        entry.uid = entry.gid = entry.mtime = 0
                        entry.uname = entry.gname = ""
                        with path.open("rb") as source:
                            archive.addfile(entry, source)
        verify_source(policy)
        outputs = {str(path.relative_to(root)): identity(path) for path in (root / "artifacts").rglob("*") if path.is_file()}
        outputs["prepared-source.tar.gz"] = identity(root / "prepared-source.tar.gz")
        receipt.update({"complete": True, "readOnlyInputsUnchanged": True, "qualification": recipe["qualification"],
                        "sourcePolicyIdentity": identity(root / "checked-source-policy.json"),
                        "typecheckReceiptIdentity": identity(root / "sdk-typecheck.process.json"),
                        "buildPlanIdentity": identity(root / "build-plan.json"), "profile": recipe["profile"],
                        "sourceCommit": recipe["sourceCommit"], "outputs": outputs, "wasmInventory": inventory,
                        "remainingGates": ["Local index/worker module packaging", "Trusted JS command registry", "Real Bash with private exec shim", "Common live fd/VFS and cancellation", "Browser guest acceptance", "Complete dependency licenses/source notices"]})
        status = 0
    except BaseException as error:
        receipt["failure"] = {"type": type(error).__name__, "error": str(error)}
        if guard.STOP is not None:
            status = 128 + guard.STOP
    finally:
        receipt["finalStatus"] = status
        guard.publish(root / "receipt.json", receipt)
        (root / "final.status").write_text(str(status) + "\n")
        guard.publish(root / "phase.json", {"phase": "complete" if status == 0 else "failed", "pid": os.getpid(), "finalStatus": status})
    return status


def launch(root):
    recipe, _ = checked_plan(root)
    allowed, observed = admitted(root, recipe)
    if not allowed:
        raise ValueError("resource admission failed; no background process launched")
    with (root / "started.json").open("x") as stream:
        json.dump({"startedAtUnix": time.time(), "admission": observed}, stream)
    with Path(recipe["supervisorLog"]).open("xb") as log:
        child = subprocess.Popen([sys.executable, str(root / "run.py"), "--run", str(root)],
                                 cwd=root, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True)
    guard.publish(root / "supervisor.json", {"pid": child.pid, "log": recipe["supervisorLog"], "status": str(root / "final.status")})
    print(json.dumps({"running": True, "pid": child.pid, "log": recipe["supervisorLog"], "status": str(root / "final.status")}))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    for name in ("check", "launch", "run"):
        modes.add_argument("--" + name, type=Path)
    parser.add_argument("--source-policy", type=Path)
    parser.add_argument("--source-policy-sha256")
    parser.add_argument("--typecheck-receipt", type=Path)
    parser.add_argument("--typecheck-receipt-sha256")
    parser.add_argument("--bindgen", type=Path)
    parser.add_argument("--bindgen-sha256")
    parser.add_argument("--node", type=Path)
    parser.add_argument("--node-sha256")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--log-directory", type=Path, default=Path.home() / "logs")
    parser.add_argument("--profile", choices=("dev", "release"), default="release")
    parser.add_argument("--reuse-checked-target", action="store_true")
    arguments = parser.parse_args()
    if arguments.run:
        return run(arguments.run.resolve())
    if arguments.launch:
        launch(arguments.launch.resolve())
    elif arguments.check:
        recipe, _ = checked_plan(arguments.check)
        allowed, observation = admitted(arguments.check, recipe)
        print(json.dumps({"prepared": True, "launched": False, "resourceAdmission": allowed, "resources": observation}))
    else:
        for name in ("source_policy", "source_policy_sha256", "typecheck_receipt", "typecheck_receipt_sha256",
                     "bindgen", "bindgen_sha256", "node", "node_sha256", "output"):
            if not getattr(arguments, name):
                parser.error("Required --" + name.replace("_", "-"))
        prepare(arguments)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
