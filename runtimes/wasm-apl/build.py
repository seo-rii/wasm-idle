#!/usr/bin/env python3
"""Build the original GNU APL 2.0 CLI with a pinned, narrow WASI host port."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import shlex
import signal
import subprocess
import tarfile
import time
import urllib.request


HERE = Path(__file__).resolve().parent
PINS = json.loads((HERE / "source-pins.json").read_text())
MEMORY_LIMIT = 256 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inventory(path):
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": digest(data)}


def scratch_size(path):
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def verify(data, pin, name):
    if len(data) != pin["bytes"] or digest(data) != pin["sha256"]:
        raise RuntimeError(f"{name}: pinned size/SHA-256 mismatch")


def run(command, cwd, env, scratch, cap):
    print(f"Running {Path(command[0]).name}", flush=True)
    child = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True)
    try:
        while child.poll() is None:
            if scratch_size(scratch) > cap:
                raise RuntimeError("GNU APL scratch exceeds the configured size limit")
            if shutil.disk_usage(scratch).free < 32 * 1024 * 1024:
                raise RuntimeError("GNU APL build stopped to preserve 32 MiB of free storage")
            time.sleep(1)
        if child.returncode:
            raise RuntimeError(f"{Path(command[0]).name} exited {child.returncode}")
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scratch-dir", type=Path, required=True)
    parser.add_argument("--wasi-sdk", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=HERE / "dist")
    parser.add_argument("--scratch-limit-mib", type=int, default=80)
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    scratch = args.scratch_dir.resolve()
    scratch.mkdir(parents=True, exist_ok=True)
    sdk = args.wasi_sdk.resolve()
    output = args.output_dir.resolve()
    if args.jobs < 1 or args.scratch_limit_mib < 48:
        parser.error("positive jobs and at least 48 MiB of scratch are required")
    cap = args.scratch_limit_mib * 1024 * 1024
    compiler = sdk / "bin/clang++"
    version = subprocess.check_output([str(compiler), "--version"], text=True)
    if not version.startswith("clang version 22.1.0-wasi-sdk") or PINS[
        "toolchain"
    ]["llvmRevision"] not in version:
        raise RuntimeError("GNU APL production requires the pinned wasi-sdk 33.0")

    for pin in PINS["licenses"]:
        verify((HERE / pin["path"]).read_bytes(), pin, pin["path"])

    archive = scratch / "apl-2.0.tar.gz"
    if not archive.exists():
        with urllib.request.urlopen(PINS["runtime"]["url"]) as response:
            archive.write_bytes(response.read(PINS["runtime"]["bytes"] + 1))
    verify(archive.read_bytes(), PINS["runtime"], archive.name)
    source = scratch / "apl-2.0"
    if source.exists():
        raise RuntimeError("Use a fresh scratch directory for each production build")
    with tarfile.open(archive) as package:
        members = package.getmembers()
        if any(
            PurePosixPath(m.name).is_absolute()
            or ".." in PurePosixPath(m.name).parts
            or not (m.isdir() or m.isfile())
            for m in members
        ):
            raise RuntimeError("Unsupported source archive member")
        package.extractall(scratch, members=members)
    if (source / "COPYING").read_bytes() != (
        HERE / "licenses/gnu-apl-GPL-3.0.txt"
    ).read_bytes():
        raise RuntimeError("GNU APL license differs from the pinned release")

    for name in ("config.sub", "config.guess"):
        shutil.copyfile(sdk / "share/misc" / name, source / name)
    port = HERE / "port"
    flags = [
        "-Os", "--no-wasm-opt", "-D_GNU_SOURCE", "-fno-ident",
        "-fwasm-exceptions", "-mllvm", "-wasm-use-legacy-eh=false",
        "-D_WASI_EMULATED_SIGNAL", "-D_WASI_EMULATED_MMAN",
        "-D_WASI_EMULATED_PROCESS_CLOCKS",
        f"-DWASM_IDLE_APL_MEMORY_LIMIT={MEMORY_LIMIT}",
        f"-ffile-prefix-map={source}=/gnu-apl",
        f"-ffile-prefix-map={HERE}=/wasm-idle-apl",
    ]
    link_flags = [
        "--no-wasm-opt", "-fwasm-exceptions", "-lunwind",
        "-lwasi-emulated-signal", "-lwasi-emulated-mman",
        "-lwasi-emulated-process-clocks", "-Wl,--strip-all",
        "-Wl,-z,stack-size=2097152", f"-Wl,--max-memory={MEMORY_LIMIT}",
    ]
    configure = [
        "./configure", "--host=wasm32-wasi", "--without-optional_libs",
        "--without-sqlite3", "--without-postgresql", "--without-pcre",
        "--without-gtk3", "--without-x", "--prefix=/usr/local",
        "CORE_COUNT_WANTED=0",
    ]
    env = {
        **os.environ,
        "TMPDIR": str(scratch), "TZ": "UTC", "SOURCE_DATE_EPOCH": "0",
        "CC": str(sdk / "bin/clang"), "CXX": str(compiler),
        "AR": str(sdk / "bin/ar"), "RANLIB": str(sdk / "bin/ranlib"),
        "CFLAGS": "-Os --no-wasm-opt -D_GNU_SOURCE -D_WASI_EMULATED_SIGNAL "
                  "-D_WASI_EMULATED_MMAN -D_WASI_EMULATED_PROCESS_CLOCKS",
        "CXXFLAGS": shlex.join(flags),
        "CPPFLAGS": shlex.join(["-I", str(port), "-include", str(port / "wasi-host.h")]),
        "LDFLAGS": shlex.join(link_flags),
        "ac_cv_func_malloc_0_nonnull": "yes",
        "ac_cv_header_sys_un_h": "no",
    }
    run(["patch", "-p1", "-i", str(HERE / "wasi-platform.patch")], source,
        env, scratch, cap)
    run(configure, source, env, scratch, cap)

    # configure embeds host time, paths and platform. Keep the executable stable
    # across physical checkouts without changing GNU APL's language machinery.
    config_path = source / "config.h"
    config = config_path.read_text()
    config = re.sub(
        r"^#define BUILDTAG .*?$",
        '#define BUILDTAG PACKAGE_NAME, PACKAGE_VERSION " / WASI", '
        '"reproducible wasm-idle build", "wasm32-wasip1", "no optional libraries"',
        config, flags=re.MULTILINE,
    )
    config = re.sub(
        r"^#define apl_DIR__src .*?$",
        '#define apl_DIR__src "/usr/local/share/apl/src"',
        config, flags=re.MULTILINE,
    )
    config = re.sub(
        r"^#define cfg_CONFIGURE_ARGS .*?$",
        lambda _: "#define cfg_CONFIGURE_ARGS " + json.dumps(" ".join(configure)),
        config, flags=re.MULTILINE,
    )
    config_path.write_text(config)
    host_object = scratch / "wasi-host.o"
    run([str(compiler), *flags, "-I", str(port), "-c",
         str(port / "wasi-host.cc"), "-o", str(host_object)], source,
        env, scratch, cap)
    run(["make", "-s", "-C", str(source / "src"), f"-j{args.jobs}",
         "apl", "common_LDFLAGS=", f"apl_LDADD={host_object} -ldl -lm"],
        source, env, scratch, cap)

    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / "src/apl", output / "apl.wasm")
    shutil.copyfile(HERE / "licenses/gnu-apl-GPL-3.0.txt", output / "LICENSE")
    notices = [
        "GNU APL 2.0 browser distribution\n",
        "GNU APL is copyright Dr. Jürgen Sauermann and contributors.\n",
        "GNU APL and this host port are distributed under GPL-3.0-or-later.\n",
        "Corresponding upstream source, host port and build recipe: "
        "https://github.com/seo-rii/wasm-idle/tree/main/runtimes/wasm-apl\n",
    ]
    for path in sorted((HERE / "licenses").glob("*.txt")):
        notices.extend([f"\n===== {path.name} =====\n", path.read_text()])
    (output / "THIRD_PARTY_NOTICES.txt").write_text("".join(notices))
    inputs = [HERE / "build.py", HERE / "source-pins.json",
              HERE / "wasi-platform.patch", *sorted(port.glob("*")),
              *sorted((HERE / "licenses").glob("*.txt"))]
    receipt = {
        "format": "wasm-apl-build-v1", "version": "2.0",
        "source": PINS["runtime"],
        "toolchain": {**PINS["toolchain"], "compiler": version.splitlines()[0]},
        "inputs": {str(p.relative_to(HERE)): inventory(p) for p in inputs},
        "configuration": {
            "configureArgs": configure[1:], "compilerFlags": [
                x for x in flags if not x.startswith("-ffile-prefix-map=")
            ], "linkerFlags": link_flags,
            "memoryLimitBytes": MEMORY_LIMIT,
        },
        "files": {name: inventory(output / name) for name in (
            "apl.wasm", "LICENSE", "THIRD_PARTY_NOTICES.txt")},
    }
    (output / "runtime-build.json").write_text(json.dumps(receipt, indent="\t") + "\n")
    print(json.dumps({"output": str(output), "wasm": receipt["files"]["apl.wasm"],
                      "scratchBytes": scratch_size(scratch)}), flush=True)


if __name__ == "__main__":
    main()
