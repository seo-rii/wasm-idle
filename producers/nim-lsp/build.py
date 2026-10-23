#!/usr/bin/env python3
"""Build the original nimlsp/nimsuggest sources; adapt only browser platform I/O."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
LOCK = ROOT / "scripts/nim-lsp-assets.lock.json"


def receipt(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def verify(data, expected, label):
    if receipt(data) != {key: expected[key] for key in ("bytes", "sha256")}:
        raise RuntimeError(f"{label} failed pinned size/SHA-256 verification")
    return data


def prepare_input(cache, item):
    archive = cache / item["archive"]
    if not archive.exists():
        with tempfile.NamedTemporaryFile(dir=cache, delete=False) as output:
            temporary = Path(output.name)
        try:
            subprocess.run(
                ["curl", "--fail", "--silent", "--show-error", "--location",
                 "--max-time", "180", "--max-filesize", str(item["bytes"]),
                 item["url"], "--output", str(temporary)], check=True
            )
            verify(temporary.read_bytes(), item, item["url"])
            temporary.replace(archive)
        finally:
            temporary.unlink(missing_ok=True)
    verify(archive.read_bytes(), item, item["archive"])
    destination = cache / "inputs" / item["directory"]
    marker = destination / ".wasm-idle-input.json"
    if marker.exists() and json.loads(marker.read_text()) == receipt(archive.read_bytes()):
        return destination
    if destination.exists():
        raise RuntimeError(f"Unverified producer input directory: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache) as temporary:
        with tarfile.open(archive) as source:
            extraction_root = Path(temporary).resolve()
            for member in source.getmembers():
                extracted = (extraction_root / member.name).resolve()
                if not extracted.is_relative_to(extraction_root):
                    raise RuntimeError("Producer archive escapes its extraction directory")
                if member.issym() or member.islnk():
                    parent = extracted.parent if member.issym() else extraction_root
                    if not (parent / member.linkname).resolve().is_relative_to(extraction_root):
                        raise RuntimeError("Producer archive contains an escaping link")
                elif not (member.isfile() or member.isdir()):
                    raise RuntimeError("Producer archive contains a special file")
            source.extractall(temporary)
        children = list(Path(temporary).iterdir())
        if len(children) != 1 or not children[0].is_dir():
            raise RuntimeError("Unexpected producer archive root")
        children[0].replace(destination)
    marker.write_text(json.dumps(receipt(archive.read_bytes())) + "\n")
    return destination


def prepare_browser_sources(cache, sources):
    destination = cache / "browser-source"
    asynchronous = cache / "browser-asynctools"
    for original, target in [(sources["nimlsp"], destination),
                             (sources["asynctools"], asynchronous)]:
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(original, target)
    entry = destination / "src/nimlsp.nim"
    source = entry.read_text()
    anchor = "when defined(windows):\n  var\n    ins = newFileStream(stdin)"
    if source.count(anchor) != 1:
        raise RuntimeError("Unexpected original nimlsp stdio entry")
    entry.write_text(source.replace(anchor,
        "when defined(windows) or defined(emscripten):\n  var\n    ins = newFileStream(stdin)"))
    process = asynchronous / "asynctools/asyncproc.nim"
    source = process.read_text()
    anchor = "  when declared(addProcess):\n    proc waitForExit*(p: AsyncProcess): Future[int] ="
    if source.count(anchor) != 1:
        raise RuntimeError("Unexpected original asynchronous process adapter")
    process.write_text(source.replace(anchor, """  when defined(emscripten):
    proc waitForExit*(p: AsyncProcess): Future[int] =
      result = newFuture[int]("asyncproc.waitForExit")
      result.fail(newException(OSError, "Subprocesses are unavailable in browser workers"))
  elif declared(addProcess):
    proc waitForExit*(p: AsyncProcess): Future[int] ="""))
    return destination, asynchronous


def build(cache, output, native=False, force=False, canonical=False):
    lock = json.loads(LOCK.read_text())
    cache.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    state = output / "producer-manifest.json"
    identity = receipt(Path(__file__).read_bytes() + json.dumps(
        lock["inputs"], sort_keys=True, separators=(",", ":")).encode())
    if not force and state.exists():
        previous = json.loads(state.read_text())
        if previous.get("identity") == identity and previous.get("native") == native:
            for name, expected in previous["files"].items():
                verify((output / name).read_bytes(), expected, name)
            return previous
    if not native and not canonical:
        # Nim's original type-signature hashes include absolute source paths.
        # Mount original inputs at stable paths instead of editing analyzer code,
        # generated C, assertion payloads, or the compiler's symbol hashing logic.
        sandbox = shutil.which("bwrap")
        if not sandbox:
            raise RuntimeError("Nim LSP builds require Linux, bubblewrap (bwrap), "
                               "and enabled unprivileged user/mount namespaces")
        command = [sandbox, "--die-with-parent", "--ro-bind", "/", "/",
                   "--tmpfs", "/tmp", "--dev", "/dev", "--ro-bind", str(ROOT), "/tmp/nim-lsp-recipe",
                   "--bind", str(cache), "/tmp/nim-lsp-build",
                   "--bind", str(output), "/tmp/nim-lsp-output",
                   "--chdir", "/tmp/nim-lsp-build", sys.executable,
                   "/tmp/nim-lsp-recipe/producers/nim-lsp/build.py",
                   "--cache-dir", "/tmp/nim-lsp-build",
                   "--out-dir", "/tmp/nim-lsp-output", "--canonical-build"]
        if force:
            command.append("--force")
        environment = {**os.environ, "TMPDIR": "/tmp", "PYTHONDONTWRITEBYTECODE": "1"}
        if subprocess.run(command, env=environment).returncode != 0:
            raise RuntimeError("Canonical Nim LSP build failed; Linux, bwrap and "
                               "working unprivileged user/mount namespaces are required")
        return json.loads(state.read_text())
    sources = {name: prepare_input(cache, item) for name, item in lock["inputs"].items()
               if name != "emscripten"}
    nim = sources["nim"]
    environment = {**os.environ, "SOURCE_DATE_EPOCH": "0", "LC_ALL": "C", "TZ": "UTC"}
    args = [str(nim / "bin/nim"), "c", "--skipUserCfg:on", "--skipParentCfg:on",
            "--parallelBuild:2", "-d:release", "--stackTrace:off", "--lineTrace:off",
            "--path:" + str(nim), "--path:" + str(sources["jsonschema"] / "src"),
            "--path:" + str(sources["ast_pattern_matching"] / "src")]
    if native:
        entry = sources["nimlsp"] / "src/nimlsp.nim"
        args += ["--path:" + str(sources["asynctools"]),
                 "-d:explicitSourcePath=" + str(nim),
                 "--nimcache:" + str(cache / "native-cache"),
                 "--out:" + str(output / "nimlsp")]
    else:
        configured_sdk = os.environ.get("WASM_IDLE_NIM_LSP_EMSDK_UPSTREAM")
        sdk = Path(configured_sdk).resolve() if configured_sdk else prepare_input(
            cache, lock["inputs"]["emscripten"])
        # The immutable official release archive labels its checkout 6.0.0-git.
        if (sdk / "emscripten/emscripten-version.txt").read_text().strip().strip('"') not in {"6.0.0", "6.0.0-git"}:
            raise RuntimeError("The Nim LSP producer requires Emscripten 6.0.0")
        config = cache / "em-config"
        config.write_text("\n".join(f"{key} = {str(value)!r}" for key, value in {
            "LLVM_ROOT": sdk / "bin", "BINARYEN_ROOT": sdk,
            "EMSCRIPTEN_ROOT": sdk / "emscripten", "NODE_JS": shutil.which("node")
        }.items()) + "\n")
        em_cache = cache / "em-cache"
        if not em_cache.exists():
            shutil.copytree(sdk / "emscripten/cache", em_cache)
        environment.update(EM_CONFIG=str(config), EM_CACHE=str(em_cache), EMCC_CORES="2",
                           BINARYEN_CORES="2", PYTHONDONTWRITEBYTECODE="1")
        entry_root, asynchronous = prepare_browser_sources(cache, sources)
        entry = entry_root / "src/nimlsp.nim"
        args += ["--path:" + str(asynchronous), "--mm:orc", "-d:useMalloc",
                 "-d:emscripten", "-d:noSignalHandler", "-d:explicitSourcePath=/nim",
                 "--cpu:wasm32", "--os:linux", "--cc:clang",
                 "--clang.exe:" + str(sdk / "emscripten/emcc"),
                 "--clang.linkerexe:" + str(sdk / "emscripten/emcc"),
                 "--nimcache:" + str(cache / "browser-cache"),
                 "--out:" + str(output / "nimlsp.mjs"),
                 "--passL:-O1 -g0 -sMODULARIZE=1 -sEXPORT_ES6=1 "
                 "-sEXPORTED_RUNTIME_METHODS=FS,callMain -sALLOW_MEMORY_GROWTH=1 "
                 "-sINITIAL_MEMORY=134217728 -sMAXIMUM_MEMORY=2147483648 "
                 "-sSTACK_SIZE=16777216 -sENVIRONMENT=web,worker,node "
                 "-sINVOKE_RUN=0 -sEXIT_RUNTIME=1"]
    subprocess.run([*args, *([] if native else ["--forceBuild:on"]), str(entry)],
                   check=True, env=environment)
    if not native:
        files = []
        for directory in ("lib", "config"):
            for source in sorted((nim / directory).rglob("*")):
                if source.is_file() and not source.is_symlink():
                    files.append({"path": source.relative_to(nim).as_posix(),
                                  "base64": base64.b64encode(source.read_bytes()).decode("ascii")})
        (output / "stdlib.json").write_text(json.dumps(
            {"format": "wasm-idle-nim-lsp-stdlib-v1", "files": files}, separators=(",", ":")) + "\n")
        for name, source in {
            "LICENSE.nim.txt": nim / "copying.txt",
            "LICENSE.nimlsp.txt": sources["nimlsp"] / "LICENSE",
            "LICENSE.asynctools.txt": sources["asynctools"] / "LICENSE",
            "LICENSE.emscripten.txt": sdk / "emscripten/LICENSE",
            "LICENSE.musl.txt": sdk / "emscripten/system/lib/libc/musl/COPYRIGHT"
        }.items():
            shutil.copyfile(source, output / name)
        declarations = "# Build-time macro package declarations\n\n"
        for name, manifest in [("jsonschema", "jsonschema.nimble"),
                               ("ast_pattern_matching", "ast_pattern_matching.nimble")]:
            declarations += lock["inputs"][name]["repository"] + "/tree/" + lock["inputs"][name]["revision"]
            declarations += "\n\n```text\n" + (sources[name] / manifest).read_text() + "```\n\n"
        (output / "NOTICES.md").write_text(declarations)
    names = ["nimlsp"] if native else ["nimlsp.mjs", "nimlsp.wasm", "stdlib.json",
        "LICENSE.nim.txt", "LICENSE.nimlsp.txt", "LICENSE.asynctools.txt",
        "LICENSE.emscripten.txt", "LICENSE.musl.txt", "NOTICES.md"]
    manifest = {"identity": identity, "native": native,
                "files": {name: receipt((output / name).read_bytes()) for name in names}}
    state.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=ROOT / ".cache/nim-lsp")
    parser.add_argument("--out-dir", type=Path)
    parser.add_argument("--native", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--canonical-build", action="store_true", help=argparse.SUPPRESS)
    options = parser.parse_args()
    target = options.out_dir or options.cache_dir / ("original-native" if options.native else "browser")
    result = build(options.cache_dir.resolve(), target.resolve(), options.native,
                   options.force, options.canonical_build)
    if not options.canonical_build:
        print(json.dumps(result))
