#!/usr/bin/env python3
"""Build the original Uiua interpreter with the reviewed WASI clock port."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tomllib
import urllib.request

ROOT = Path(__file__).resolve().parent
SOURCE = {
    "version": "0.19.1",
    "revision": "face052446efdf2b0c31c3fb44a838fe793a0f83",
    "url": "https://static.crates.io/crates/uiua/uiua-0.19.1.crate",
    "bytes": 1665068,
    "sha256": "c444c37f4342590ee616bce256d1b7f69dceaa96dea79542f5d4271e827d4a01",
}


def receipt(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def prepare_source():
    with urllib.request.urlopen(SOURCE["url"], timeout=60) as response:
        archive = response.read(SOURCE["bytes"] + 1)
    if receipt(archive) != {key: SOURCE[key] for key in ("bytes", "sha256")}:
        raise RuntimeError("Uiua source does not match the pinned archive")
    cache = ROOT / ".cache"
    cache.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as source:
        members = source.getmembers()
        if len(members) > 10000 or sum(item.size for item in members) > 50_000_000:
            raise RuntimeError("Uiua source archive exceeds its extraction budget")
        for member in members:
            name = Path(member.name)
            if name.is_absolute() or ".." in name.parts or name.parts[0] != "uiua-0.19.1":
                raise RuntimeError("Unsafe Uiua archive path")
            target = cache / name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as stream:
                    target.write_bytes(stream.read())
            else:
                raise RuntimeError("Unsupported Uiua archive entry")
    directory = cache / "uiua-0.19.1"
    subprocess.run(
        ["patch", "--batch", "--fuzz=0", "-p1", "-i", str(ROOT / "patches/wasi-clock.patch")],
        cwd=directory,
        check=True,
    )
    return directory


def third_party_notices(target):
    packages = set()
    for dependency_file in target.rglob("*.d"):
        packages.update(Path(name) for name in re.findall(
            r"(/[^\s:]+/registry/src/[^/\s]+/[^/\s]+)/",
            dependency_file.read_text(errors="replace"),
        ))
    if not packages:
        raise RuntimeError("No compiled dependency license inputs found")
    parts = ["Uiua console interpreter: third-party source notices\n"]
    for package in sorted(packages, key=lambda item: item.name):
        metadata = tomllib.loads((package / "Cargo.toml").read_text())["package"]
        parts.append(f"\n=== {metadata['name']} {metadata['version']} ({metadata.get('license', 'see text')}) ===\n")
        texts = sorted(file for file in package.iterdir() if file.is_file() and
                       file.name.lower().startswith(("license", "copying", "copyright")))
        if not texts and metadata["name"] == "uiua_parser":
            texts = [ROOT / ".cache/uiua-0.19.1/license"]
        if not texts and metadata["name"] == "highway":
            texts = [ROOT / "licenses/highway-1.3.0.txt"]
        if not texts:
            raise RuntimeError(f"Missing license text for {package.name}")
        for file in texts:
            parts.extend([f"\n--- {file.name} ---\n", file.read_text()])
    sysroot = Path(subprocess.check_output(["rustc", "--print", "sysroot"], text=True).strip())
    documents = sysroot / "share/doc/rust"
    parts.extend(["\n=== Rust 1.94.0 standard library and runtime dependencies ===\n",
                  (documents / "COPYRIGHT-library.html").read_text()])
    for file in sorted((documents / "licenses").iterdir()):
        if file.is_file():
            parts.extend([f"\n--- Rust licenses/{file.name} ---\n", file.read_text()])
    return "\n".join(parts).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-dir", required=True, type=Path,
                        help="Dedicated target directory for this physical producer checkout")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    options = parser.parse_args()
    source = prepare_source()
    target = options.target_dir.resolve()
    output = options.output.resolve()
    environment = os.environ.copy()
    environment["CARGO_TARGET_DIR"] = str(target)
    environment["CARGO_BUILD_BUILD_DIR"] = str(target / "build")
    environment["CARGO_INCREMENTAL"] = "0"
    cargo_home = Path(environment.get("CARGO_HOME", Path.home() / ".cargo")).resolve()
    sysroot = subprocess.check_output(["rustc", "--print", "sysroot"], text=True).strip()
    environment["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join([
        f"--remap-path-prefix={ROOT}=/uiua-producer",
        f"--remap-path-prefix={cargo_home}=/cargo",
        f"--remap-path-prefix={sysroot}=/rust-toolchain",
    ])
    rustc = subprocess.check_output(["rustc", "--version"], text=True).strip()
    if not rustc.startswith("rustc 1.94.0 "):
        raise RuntimeError("Use the pinned Rust 1.94.0 toolchain")
    subprocess.run(
        ["cargo", "build", "--locked", "--release", "--target", "wasm32-wasip1", "-j", "1"],
        cwd=ROOT,
        env=environment,
        check=True,
    )
    wasm = (target / "wasm32-wasip1/release/wasm-idle-uiua.wasm").read_bytes()
    if not wasm.startswith(b"\0asm"):
        raise RuntimeError("Uiua build did not produce a WebAssembly module")
    output.mkdir(parents=True, exist_ok=True)
    (output / "uiua.wasm").write_bytes(wasm)
    (output / "LICENSE.txt").write_bytes((source / "license").read_bytes())
    notices = third_party_notices(target)
    (output / "THIRD_PARTY_NOTICES.txt").write_bytes(notices)
    inputs = ["Cargo.toml", "Cargo.lock", "src/main.rs", "patches/wasi-clock.patch",
              "build.py", "licenses/highway-1.3.0.txt"]
    manifest = {
        "schemaVersion": 1,
        "language": "UIUA",
        "implementation": {"name": "Uiua", **SOURCE, "license": "MIT"},
        "producer": {"rustc": rustc, "target": "wasm32-wasip1",
                     "features": ["native_sys"], "defaultFeatures": False,
                     "pathRemapping": {"producer": "/uiua-producer", "cargo": "/cargo",
                                       "toolchain": "/rust-toolchain"},
                     "inputs": {name: receipt((ROOT / name).read_bytes()) for name in inputs}},
        "artifacts": {"uiua.wasm": receipt(wasm),
                      "LICENSE.txt": receipt((output / "LICENSE.txt").read_bytes()),
                      "THIRD_PARTY_NOTICES.txt": receipt(notices)},
        "profile": "Original console compiler/interpreter with real WASI stdin/stdout and private workspace",
    }
    (output / "runtime-build.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest["artifacts"]))


if __name__ == "__main__":
    main()
