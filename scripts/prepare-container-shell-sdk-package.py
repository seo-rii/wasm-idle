#!/usr/bin/env python3
"""Prepare one bounded local host-module packaging attempt after the real SDK binary gate."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import container_shell_sdk_build_guard as guard


def identity(path):
    path = Path(path)
    return {"bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def verify_pins(pins):
    for path, expected in pins.items():
        if Path(path).is_symlink() or identity(path) != expected:
            raise ValueError(f"pinned packaging input changed: {path}")


def checked(root):
    pins = json.loads((root / "prepared-inputs.json").read_text())
    verify_pins(pins)
    plan = json.loads((root / "plan.json").read_text())
    verify_pins(plan["inputPins"])
    return plan


def execute(root, check_only=False):
    guard.enable_cleanup()
    status = 3
    try:
        plan = checked(root)
        if not check_only and not (root / "started.json").is_file():
            raise ValueError("start only through --launch")
        name = "package-check" if check_only else "package"
        stage = {"name": name, "argv": [plan["node"], "--disable-wasm-trap-handler", "--wasm-num-compilation-tasks=1",
                                        str(root / "package.mjs"), str(root / "request.json")],
                 "log": plan["logs"][name], "wallSeconds": 120}
        if check_only:
            stage["argv"].append("--check")
        guard.run_stage(root, stage, {"HOME": str(Path.home()), "PATH": "/usr/bin:/bin"}, root,
                        {"cpuSoftSeconds": 90, "cpuHardSeconds": 96, "addressSpaceBytes": 12 * 1024**3,
                         "minimumRemainingDiskBytes": 1024**3})
        verify_pins(plan["inputPins"])
        status = 0
    except BaseException as error:
        guard.publish(root / ("check-failure.json" if check_only else "failure.json"),
                      {"type": type(error).__name__, "error": str(error)})
        if guard.STOP is not None:
            status = 128 + guard.STOP
    finally:
        (root / ("check.status" if check_only else "final.status")).write_text(str(status) + "\n")
        guard.publish(root / "phase.json", {"phase": "check-complete" if check_only else "complete" if status == 0 else "failed",
                                          "pid": os.getpid(), "finalStatus": status})
    return status


def prepare(args):
    tools = {name: Path(getattr(args, name)).resolve() for name in (
        "binary_receipt", "node", "esbuild_api", "esbuild_package", "esbuild_binary")}
    pins = {}
    for name, path in tools.items():
        observed = identity(path)
        if observed["sha256"] != getattr(args, name + "_sha256"):
            raise ValueError(f"independent packaging digest mismatch: {path}")
        pins[str(path)] = observed
    receipt = json.loads(tools["binary_receipt"].read_text())
    if receipt.get("complete") is not True or receipt.get("readOnlyInputsUnchanged") is not True or receipt.get("finalStatus") != 0:
        raise ValueError("the actual SDK Wasm/bindgen binary gate has not passed")
    root = args.output.resolve()
    if root.exists():
        raise ValueError("packaging preparation output must be fresh")
    logs = args.log_directory.resolve()
    logs.mkdir(mode=0o700, parents=True, exist_ok=True)
    if logs.stat().st_mode & 0o077:
        raise ValueError("packaging log directory must be private")
    log_paths = {name: str(logs / (root.name + "-" + name + ".log")) for name in ("package-check", "package", "supervisor")}
    if any(Path(path).exists() for path in log_paths.values()):
        raise ValueError("refuse an existing packaging log")
    root.mkdir(mode=0o700)
    for source, destination in ((Path(__file__), "run.py"), (Path(guard.__file__), "container_shell_sdk_build_guard.py"),
                                (Path(__file__).with_name("package-container-shell-sdk.mjs"), "package.mjs")):
        shutil.copyfile(source, root / destination)
    request = {"binaryReceipt": str(tools["binary_receipt"]), "binaryReceiptSha256": args.binary_receipt_sha256,
               "nodeSha256": args.node_sha256, "output": str(root / "local-package")}
    for name, prefix in (("esbuild_api", "esbuildApi"), ("esbuild_package", "esbuildPackage"), ("esbuild_binary", "esbuildBinary")):
        request[prefix] = str(tools[name])
        request[prefix + "Sha256"] = getattr(args, name + "_sha256")
    guard.publish(root / "request.json", request)
    guard.publish(root / "plan.json", {"schemaVersion": 1, "node": str(tools["node"]), "inputPins": pins,
                                      "logs": log_paths, "qualification": "Local trusted host-module packaging only; no guest qualification"})
    guard.publish(root / "prepared-inputs.json", {str(root / name): identity(root / name) for name in (
        "run.py", "container_shell_sdk_build_guard.py", "package.mjs", "request.json", "plan.json")})
    print(json.dumps({"prepared": True, "packaged": False, "output": str(root)}))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    for name in ("check", "launch", "run"):
        modes.add_argument("--" + name, type=Path)
    for name in ("binary-receipt", "node", "esbuild-api", "esbuild-package", "esbuild-binary"):
        parser.add_argument("--" + name, type=Path)
        parser.add_argument("--" + name + "-sha256")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--log-directory", type=Path, default=Path.home() / "logs")
    args = parser.parse_args()
    if args.run:
        return execute(args.run.resolve())
    if args.check:
        return execute(args.check.resolve(), check_only=True)
    if args.launch:
        root = args.launch.resolve()
        plan = checked(root)
        with (root / "started.json").open("x") as stream:
            json.dump({"pid": os.getpid()}, stream)
        with Path(plan["logs"]["supervisor"]).open("xb") as log:
            child = subprocess.Popen([sys.executable, str(root / "run.py"), "--run", str(root)],
                                     cwd=root, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                     start_new_session=True)
        result = {"launched": True, "pid": child.pid, "log": plan["logs"]["supervisor"], "status": str(root / "final.status")}
        guard.publish(root / "supervisor.json", result)
        print(json.dumps(result))
    else:
        for name in ("binary_receipt", "node", "esbuild_api", "esbuild_package", "esbuild_binary"):
            for argument in (name, name + "_sha256"):
                if not getattr(args, argument):
                    parser.error("Required --" + argument.replace("_", "-"))
        if args.output is None:
            parser.error("Required --output")
        prepare(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
