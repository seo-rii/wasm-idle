#!/usr/bin/env python3
"""Build the original HaMLet Standard ML implementation as a WASI program."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent
PINS = json.loads((ROOT / "sources.json").read_text())


def receipt(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def run(command, cwd, environment):
    print("Run", " ".join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), cwd=cwd, env=environment, check=True)


def extract(name, pin, scratch):
    destination = scratch / name
    stamp = destination / ".archive-sha256"
    if stamp.exists() and stamp.read_text().strip() == pin["sha256"]:
        return destination
    with urllib.request.urlopen(pin["url"], timeout=60) as response:
        data = response.read(pin["bytes"] + 1)
    if receipt(data) != {key: pin[key] for key in ("bytes", "sha256")}:
        raise RuntimeError(f"Source checksum mismatch: {name}")
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
        members = archive.getmembers()
        if len(members) > 20000 or sum(item.size for item in members) > 300_000_000:
            raise RuntimeError("Source archive exceeds its extraction budget")
        for item in members:
            original = Path(item.name)
            if original.is_absolute() or ".." in original.parts:
                raise RuntimeError("Unsafe source path")
            relative = Path(*original.parts[1:])
            if not relative.parts:
                continue
            first = relative.parts[0]
            if name == "mlton-source" and not (
                first in {"runtime", "include", "bin", "basis-library"}
                or first.startswith("Makefile") or str(relative) in {"LICENSE", "configure"}
            ):
                continue
            if name == "mlton-native" and first not in {"bin", "lib"}:
                continue
            target = destination / relative
            if item.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif item.isfile() or item.islnk():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(item).read())
                target.chmod(item.mode & 0o777)
                os.utime(target, (item.mtime, item.mtime))
            elif item.issym():
                if Path(item.linkname).is_absolute():
                    raise RuntimeError("Unsafe archive symlink")
                target.parent.mkdir(parents=True, exist_ok=True)
                resolved = (target.parent / item.linkname).resolve()
                if not resolved.is_relative_to(destination.resolve()):
                    raise RuntimeError("Unsafe archive symlink")
                if not target.is_symlink():
                    target.symlink_to(item.linkname)
            else:
                raise RuntimeError("Unsupported archive member")
    stamp.write_text(pin["sha256"] + "\n")
    return destination


def sml_string(data):
    return '"' + ''.join(chr(byte) if 32 <= byte < 127 and byte not in (34, 92)
                        else "\\%03d" % byte for byte in data) + '"'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scratch-dir", required=True, type=Path)
    parser.add_argument("--wasi-sdk", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    options = parser.parse_args()
    scratch = options.scratch_dir.resolve()
    scratch.mkdir(parents=True, exist_ok=True)
    sdk = options.wasi_sdk.resolve()
    clang = sdk / "bin/clang"
    version = subprocess.check_output([clang, "--version"], text=True).splitlines()[0]
    if "22.1.0-wasi-sdk" not in version:
        raise RuntimeError("Use wasi-sdk 33 (Clang 22.1.0)")
    for name, pin in PINS.items():
        extract(name, pin, scratch)
    environment = os.environ.copy()
    environment["TMPDIR"] = str(scratch)
    environment["PATH"] = str(scratch / "mlton-native/bin") + os.pathsep + environment["PATH"]
    environment["CC"] = str(clang)
    environment["AR"] = str(sdk / "bin/ar")
    environment["RANLIB"] = str(sdk / "bin/ranlib")
    # Autoconf's unprototyped raise() probe is incompatible with the WASM ABI.
    # The real prototype and linked implementation are part of WASI's signal shim.
    environment["ac_cv_func_raise"] = "yes"
    native = scratch / "mlton-native/bin/mlton"
    gmp = scratch / "gmp"
    gmp_prefix = scratch / "gmp-install"
    if not (gmp_prefix / "lib/libgmp.a").exists():
        run(["./configure", "--host=wasm32-wasi", "--prefix=" + str(gmp_prefix),
             "--disable-assembly", "--disable-shared", "--enable-static",
             "CFLAGS=-Os -D_WASI_EMULATED_SIGNAL", "LDFLAGS=-lwasi-emulated-signal"],
            gmp, environment)
        run(["make", "-j2", "MAKEINFO=true"], gmp, environment)
        run(["make", "MAKEINFO=true", "install"], gmp, environment)
    shutil.copyfile(ROOT / "node-wasi.mjs", scratch / "node-wasi.mjs")
    mlton_source = scratch / "mlton-source"
    target_library = scratch / "mlton-native/lib/mlton/targets/wasm32-wasi/libmlton.a"
    if not target_library.exists() or not target_library.with_name("libgdtoa.a").exists():
        run(["make", "-j2", "CROSS_PREFIX=", "CC=" + str(clang),
             "AR=" + str(sdk / "bin/ar"), "RANLIB=" + str(sdk / "bin/ranlib"),
             "TARGET_OS=wasi", "TARGET_ARCH=wasm32", "TARGET=wasm32-wasi",
             "WITH_GMP_DIR=" + str(gmp_prefix), "PREFIX=" + str(scratch / "mlton-native"),
             "OLD_MLTON=" + str(native), "SELF_COMPILE=false", "WITH_DBG_RUNTIME=false",
             "WITH_DPI_RUNTIME=true", "EMULATE=node " + str(scratch / "node-wasi.mjs"),
             "dirs", "runtime"], mlton_source, environment)
        run(["make", "TARGET_OS=wasi", "TARGET_ARCH=wasm32", "TARGET=wasm32-wasi",
             "PREFIX=" + str(scratch / "mlton-native"), "OLD_MLTON=" + str(native),
             "SELF_COMPILE=false", "install-runtime"], mlton_source, environment)
    pointer_patch = ROOT / "patches/mlton-wasi-pointer.patch"
    pointer_marker = scratch / ".mlton-pointer-patch"
    pointer_hash = receipt(pointer_patch.read_bytes())["sha256"]
    if not pointer_marker.exists():
        run(["patch", "--batch", "--fuzz=0", "-p1", "-i", pointer_patch],
            mlton_source, environment)
        pointer_marker.write_text(pointer_hash)
    elif pointer_marker.read_text() != pointer_hash:
        raise RuntimeError("MLton pointer patch changed; use a fresh scratch directory")
    shutil.copyfile(mlton_source / "runtime/basis/cpointer.h",
                    scratch / "mlton-native/lib/mlton/include/basis/cpointer.h")
    hamlet = scratch / "hamlet"
    patch_marker = hamlet / ".embedding-patch-sha256"
    patch_hash = receipt((ROOT / "patches/embedding.patch").read_bytes())["sha256"]
    if not patch_marker.exists():
        run(["patch", "--batch", "--fuzz=0", "-p1", "-i", ROOT / "patches/embedding.patch"],
            hamlet, environment)
        patch_marker.write_text(patch_hash)
    elif patch_marker.read_text() != patch_hash:
        raise RuntimeError("Embedding patch changed; use a fresh scratch directory")
    run(["make", "SYSTEM=mlton", "hamlet.mlb"], hamlet, environment)
    basis_sources = sorted((hamlet / "basis").glob("*.sml"))
    embedded = "val embeddedBasis : (string * string) list = [\n" + ",\n".join(
        "(" + sml_string(file.name.encode()) + "," + sml_string(file.read_bytes()) + ")"
        for file in basis_sources
    ) + "];\n"
    (hamlet / "embedded-basis.sml").write_text(embedded)
    shutil.copyfile(ROOT / "runner.sml", hamlet / "runner.sml")
    mlb = (hamlet / "hamlet.mlb").read_text()
    if mlb.count("main/wrap-mlton.sml") != 1:
        raise RuntimeError("Unexpected upstream ML Basis entry point")
    (hamlet / "browser.mlb").write_text(mlb.replace("main/wrap-mlton.sml",
                                                           "embedded-basis.sml\nrunner.sml"))
    wasm_file = hamlet / "sml.wasm"
    run([native, "-target", "wasm32-wasi", "-codegen", "c", "-cc", clang,
         "-cc-opt", "-Oz", "-cc-opt", "-ffile-prefix-map=" + str(scratch) + "=/sml-build",
         "-link-opt", "-Wl,--strip-all", "-link-opt", "-Wl,-z,stack-size=8388608",
         "-output", wasm_file, "browser.mlb"], hamlet, environment)
    output = options.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    wasm = wasm_file.read_bytes()
    if not wasm.startswith(b"\0asm") or len(wasm) > 20 * 1024 * 1024:
        raise RuntimeError("Invalid Standard ML WebAssembly output")
    (output / "sml.wasm").write_bytes(wasm)
    license_text = (hamlet / "LICENSE.txt").read_bytes()
    (output / "LICENSE.txt").write_bytes(license_text)
    notices = ["Standard ML browser runtime: original dependency notices\n"]
    for label, files in [
        ("HaMLet's SML/NJ library", [hamlet / "smlnj-lib/LICENSE.txt"]),
        ("MLton 20241230 (HPND)", [mlton_source / "LICENSE"]),
        ("GMP 6.3.0 (GPL-2.0-or-later option)",
         [gmp / "COPYINGv2", gmp / "COPYINGv3", gmp / "COPYING.LESSERv3"]),
    ]:
        notices.append("\n=== " + label + " ===\n")
        for file in files:
            notices.extend(["\n--- " + file.name + " ---\n", file.read_text()])
    for file in sorted((mlton_source / "runtime/gdtoa").glob("*")):
        if file.is_file() and file.name.lower() in {"readme", "copyright", "license"}:
            notices.extend(["\n=== MLton gdtoa " + file.name + " ===\n", file.read_text()])
    notices.extend(["\n=== WASI C library and compiler runtime ===\n",
                    (ROOT / "licenses/wasi-libraries.txt").read_text()])
    notices_text = "\n".join(notices).encode()
    (output / "THIRD_PARTY_NOTICES.txt").write_bytes(notices_text)
    input_names = ["build.py", "sources.json", "runner.sml", "node-wasi.mjs", "patches/embedding.patch", "patches/mlton-wasi-pointer.patch", "licenses/wasi-libraries.txt"]
    manifest = {
        "schemaVersion": 1, "language": "SML",
        "implementation": {"name": "HaMLet", "version": "2.0.1", **PINS["hamlet"]},
        "producer": {"mlton": "20241230", "target": "wasm32-wasip1", "wasiSdk": "33",
                     "clang": version, "sourcePins": PINS,
                     "inputs": {name: receipt((ROOT / name).read_bytes()) for name in input_names}},
        "artifacts": {name: receipt((output / name).read_bytes()) for name in
                      ["sml.wasm", "LICENSE.txt", "THIRD_PARTY_NOTICES.txt"]},
        "profile": "Original SML97 parser, elaborator, evaluator and embedded Basis library with real WASI I/O",
    }
    (output / "runtime-build.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest["artifacts"]))


if __name__ == "__main__":
    main()
