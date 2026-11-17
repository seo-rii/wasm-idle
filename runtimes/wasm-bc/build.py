#!/usr/bin/env python3
"""Build original bc 7.0.3 with wasi-sdk 33 and the WASI signal-mask port."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent
SOURCE = {
    "version": "7.0.3",
    "url": "https://github.com/gavinhoward/bc/releases/download/7.0.3/bc-7.0.3.tar.xz",
    "bytes": 474800,
    "sha256": "91eb74caed0ee6655b669711a4f350c25579778694df248e28363318e03c7fc4",
}


def receipt(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-dir", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    parser.add_argument("--wasi-sdk", type=Path,
                        default=Path(os.environ.get("WASI_SDK_PATH", Path.home() / ".local/share/wasi-sdk-33")))
    args = parser.parse_args()
    compiler = args.wasi_sdk.resolve() / "bin/clang"
    version = subprocess.check_output([str(compiler), "--version"], text=True).splitlines()[0]
    if not version.startswith("clang version 22.1.0-wasi-sdk"):
        raise RuntimeError("Use wasi-sdk 33.0 (Clang 22.1.0)")
    archive = ROOT / "vendor/bc-7.0.3.tar.xz"
    if receipt(archive.read_bytes()) != {key: SOURCE[key] for key in ("bytes", "sha256")}:
        raise RuntimeError("bc source archive differs from its pin")
    args.build_dir.mkdir(parents=True, exist_ok=True)
    flags = ["-Os", "-mllvm", "-wasm-enable-sjlj", "-mexception-handling", "-D_WASI_EMULATED_SIGNAL"]
    linker = ["-mexception-handling", "-lsetjmp", "-lwasi-emulated-signal", "-Wl,--strip-all"]
    configure = ["--bc-only", "--disable-history", "--disable-nls", "--disable-man-pages",
                 "--disable-generated-tests", "--disable-strip"]
    with tempfile.TemporaryDirectory(prefix="bc-", dir=args.build_dir.resolve()) as temporary:
        temporary = Path(temporary)
        with tarfile.open(archive, "r:xz") as source:
            members = source.getmembers()
            if len(members) > 10000 or sum(item.size for item in members) > 20_000_000:
                raise RuntimeError("bc archive exceeds extraction limits")
            for item in members:
                name = PurePosixPath(item.name)
                if name.is_absolute() or ".." in name.parts or name.parts[0] != "bc-7.0.3":
                    raise RuntimeError("Unsafe bc archive path")
                target = temporary / item.name
                if item.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                elif item.isfile():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(source.extractfile(item).read())
                    target.chmod(item.mode & 0o777)
                elif item.issym():
                    link = PurePosixPath(item.linkname)
                    if link.is_absolute() or ".." in link.parts:
                        raise RuntimeError("Unsafe bc archive link")
                    target.symlink_to(item.linkname)
                else:
                    raise RuntimeError("Unsupported bc archive entry")
        directory = temporary / "bc-7.0.3"
        subprocess.run(["patch", "--batch", "--fuzz=0", "-p1", "-i",
                        str(ROOT / "patches/wasi-signals.patch")], cwd=directory, check=True)
        environment = os.environ.copy()
        environment.update(CC=str(compiler), HOSTCC=shutil.which("cc") or "cc", HOSTCFLAGS="-O2",
                           CFLAGS=" ".join(flags + [f"-ffile-prefix-map={directory}=/bc-source"]),
                           LDFLAGS=" ".join(linker))
        subprocess.run(["sh", "./configure.sh", *configure], cwd=directory, env=environment, check=True)
        subprocess.run(["make", "-j2"], cwd=directory, env=environment, check=True)
        wasm = (directory / "bin/bc").read_bytes()
        if not wasm.startswith(b"\0asm"):
            raise RuntimeError("bc compiler did not emit WebAssembly")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    license_bytes = (ROOT / "LICENSE.txt").read_bytes()
    notices = b"bc WASI runtime third-party notices\n" + b"\n".join(
        b"\n=== " + file.name.encode() + b" ===\n" + file.read_bytes()
        for file in sorted((ROOT / "licenses").iterdir()) if file.is_file()
    )
    artifacts = {"bc.wasm": wasm, "LICENSE.txt": license_bytes, "THIRD_PARTY_NOTICES.txt": notices}
    for name, data in artifacts.items():
        (output / name).write_bytes(data)
    inputs = ["build.py", "patches/wasi-signals.patch", "LICENSE.txt", "vendor/bc-7.0.3.tar.xz"]
    inputs += [str(file.relative_to(ROOT)) for file in sorted((ROOT / "licenses").iterdir()) if file.is_file()]
    manifest = {
        "schemaVersion": 1, "language": "BC", "implementation": {"name": "bc", **SOURCE, "license": "BSD-2-Clause"},
        "producer": {"name": "wasi-sdk", "version": "33.0", "compiler": version,
                     "target": "wasm32-wasi", "configure": configure, "cflags": flags,
                     "ldflags": linker, "sourcePaths": "/bc-source",
                     "inputs": {name: receipt((ROOT / name).read_bytes()) for name in inputs}},
        "artifacts": {name: receipt(data) for name, data in artifacts.items()},
        "execution": {"argv": ["bc", "-q", "-R", "-f", "<activePath>", "...programArgs"],
                      "stdin": "original read() and original EOF errors", "exceptionHandling": "Wasm EH for native setjmp/longjmp"}
    }
    (output / "runtime-build.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest["artifacts"]))


if __name__ == "__main__":
    main()
