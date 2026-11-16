#!/usr/bin/env python3
"""Prepare the original MoonBit Wasm compiler and matching, unmodified core sources."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent
REVISION = "d4ada10d212b5376f7f8bf49cd2fbaa275a395df"
ARCHIVE = {
    "url": "https://github.com/moonbitlang/moonbit-compiler/releases/download/v0.10.19%2B97801ee1b/moonbit-wasm.tar.gz",
    "bytes": 4176888,
    "sha256": "ab55f4d92206916308922c768033d8a1b0eef5a2a3ea4c3ba8569c52cd40e2a9",
}
FILES = {
    "moonc.js": (10250, "3fcd7b44506ee8b60264a4e4972adafae8f31dedc7e91879d419dd006ef83ec4"),
    "moonc.assets/code-172607e03e4760bd9001.wasm": (5525140, "8e345f26b77901f4cbc7f7c1ee9aff3f68821e38682dd32da39e17e545a2fac2"),
    "core.tar.gz": (2253163, "b2426aa085b3c7bf31af07e2c652701461cd9fe5c7b79dd7a8578f124e87e5c1"),
}
NOTICES = {
    "COMPILER-LICENSE.txt": (31060, "c4ed4d95e9fcbd1334ca52054177520833bd0453a87d7cf535a1b2762d515be5"),
    "CORE-LICENSE.txt": (11367, "86460c45017ffacb9aa9e18850fa9fdb036339dc8851125465f4a3f3442fc894"),
    "CORE-NOTICE.txt": (7992, "a20a618afc132a32e340f567fc2fb4296cfbefda7284422b6085afcd394e478d"),
}


def receipt(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def verify(data, pin, label):
    if receipt(data) != {"bytes": pin[0], "sha256": pin[1]}:
        raise RuntimeError("MoonBit source receipt mismatch: " + label)


def packages_from_archive(archive):
    """Read only build metadata from the exact pinned core archive, never user source."""
    members = {m.name: m for m in archive if m.isfile()}
    packages = {}
    for name, member in members.items():
        if not name.endswith("/moon.pkg"):
            continue
        package = name.removeprefix("./core/").removesuffix("/moon.pkg")
        if any(part == "async" or part.endswith(("_test", "_tests")) for part in package.split("/")):
            continue
        source = archive.extractfile(member).read().decode()
        source = re.sub(r"//[^\n]*", "", source)
        dependencies = []
        for match in re.finditer(r'import\s*\{([^}]*)\}\s*(for\s+"[^"]+"\s*)?', source):
            if match[2]:
                continue
            cfg = re.search(r"#cfg\(([^\n]+)\)\s*$", source[:match.start()].rstrip())
            if cfg:
                # The pinned archive contains only positive target and any(target,...) clauses.
                if not re.fullmatch(r'(?:any\()?target="(?:native|wasm|js)"(?:,\s*target="(?:native|wasm|js)")*\)?', cfg[1]):
                    raise RuntimeError("Unreviewed core metadata condition: " + cfg[1])
                continue  # None of those native/wasm/js-only imports target wasm-gc.
            for dep in re.finditer(r'"moonbitlang/core/([^"\n]+)"(?:\s*@([\w/]+))?', match[1]):
                dependencies.append((dep[1], dep[2] or dep[1].rsplit("/", 1)[-1]))
        targets = {m[1]: json.loads(m[2]) for m in re.finditer(r'"([^"\n]+\.mbt)"\s*:\s*(\[[^\]]*\])', source)}
        files = []
        prefix = f"./core/{package}/"
        for path, item in members.items():
            if not path.startswith(prefix) or not path.endswith(".mbt"):
                continue
            filename = path[len(prefix):]
            if "/" in filename or filename.endswith(("_test.mbt", "_wbtest.mbt")):
                continue
            condition = targets.get(filename)
            active = {"wasm-gc", "release"}
            if condition and ((condition[0] == "not" and active.intersection(condition[1:])) or (condition[0] != "not" and not active.intersection(condition))):
                continue
            files.append(f"{package}/{filename}")
        packages[package] = {"dependencies": dependencies, "files": sorted(files)}
    return packages


def build_core(inputs, build_root):
    marker = build_root / ".wasm-idle-moonbit-producer"
    if (build_root / "_build").exists() and not marker.exists():
        raise RuntimeError("Refusing to clear an unowned MoonBit build directory")
    build_root.mkdir(parents=True, exist_ok=True)
    marker.write_text(REVISION + "\n")
    # A pre-existing prelude must never enter the compiler's builtin bootstrap.
    shutil.rmtree(build_root / "_build", ignore_errors=True)
    with tarfile.open(inputs / "core.tar.gz", "r:gz") as archive:
        packages = packages_from_archive(archive)
        built = []
        visiting = set()

        def build(package):
            if package in built:
                return
            if package in visiting:
                raise RuntimeError("Cyclic core metadata: " + package)
            visiting.add(package)
            item = packages[package]
            for dependency, _alias in item["dependencies"]:
                build(dependency)
            for name in item["files"]:
                target = build_root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile("./core/" + name).read())
            output = f"_build/{package}/{package.rsplit('/', 1)[-1]}.core"
            (build_root / output).parent.mkdir(parents=True, exist_ok=True)
            command = ["node", str(inputs / "moonc.js"), "build-package", "-pkg", "moonbitlang/core/" + package, "-target", "wasm-gc", "-std-path", "_build", "-o", output, "-w", "-a"]
            for dependency, alias in item["dependencies"]:
                command.extend(["-i", f"_build/{dependency}/{dependency.rsplit('/', 1)[-1]}.mi:{alias}"])
            subprocess.run([*command, *item["files"]], cwd=build_root, check=True)
            visiting.remove(package)
            built.append(package)

        for package in sorted(packages):
            if package != "prelude":
                build(package)
        build("prelude")
    core_files = [f"_build/{p}/{p.rsplit('/', 1)[-1]}.core" for p in built]
    subprocess.run(["node", str(inputs / "moonc.js"), "bundle-core", *core_files, "-o", "_build/core.core"], cwd=build_root, check=True)
    destination = build_root / "stdlib.tar"
    entries = [(f"std/{p}/{p.rsplit('/', 1)[-1]}.mi", build_root / f"_build/{p}/{p.rsplit('/', 1)[-1]}.mi") for p in sorted(built)]
    entries.append(("std/core.core", build_root / "_build/core.core"))
    with tarfile.open(destination, "w", format=tarfile.USTAR_FORMAT) as output:
        for name, path in entries:
            data = path.read_bytes()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            output.addfile(info, io.BytesIO(data))
    return destination, sorted(built)


def materialize(inputs, build_root, output):
    for name, pin in FILES.items():
        verify((inputs / name).read_bytes(), pin, name)
    stdlib, packages = build_core(inputs, build_root)
    output.mkdir(parents=True, exist_ok=True)
    assets = {}
    for name, source in [(n, inputs / n) for n in FILES if n != "core.tar.gz"] + [("stdlib.tar", stdlib)]:
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.resolve() != source.resolve():
            destination.unlink(missing_ok=True)
            try:
                os.link(source, destination)
            except OSError:
                shutil.copyfile(source, destination)
        assets[name] = receipt(destination.read_bytes())
    notices = {}
    for name, pin in NOTICES.items():
        data = (ROOT / "licenses" / name).read_bytes()
        verify(data, pin, name)
        (output / name).write_bytes(data)
        notices[name] = receipt(data)
    manifest = {
        "schemaVersion": 1,
        "implementation": "Original MoonBit Wasm compiler and matching core",
        "version": "0.10.19+97801ee1b",
        "coreVersion": "0.1.20261030+97801ee1b",
        "revision": REVISION,
        "archive": ARCHIVE,
        "coreArchive": {"member": "core.tar.gz", **receipt((inputs / "core.tar.gz").read_bytes())},
        "source": {"repository": "https://github.com/moonbitlang/moonbit-compiler", "revision": REVISION, "license": "LicenseRef-MoonBit-Public-Source-License", "modified": False},
        "coreLicense": "Apache-2.0",
        "packages": packages,
        "assets": assets,
        "notices": notices,
    }
    (output / "upstream.json").write_text(json.dumps(manifest, indent="\t") + "\n")
    print("Prepared original MoonBit compiler with " + str(len(packages)) + " core packages")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-research", action="store_true", help="Local research only; does not authorize publication or grant license permission")
    parser.add_argument("--output", type=Path, default=ROOT / "../../static/wasm-moonbit")
    parser.add_argument("--input-dir", type=Path, help="Reuse the three exact verified release members")
    parser.add_argument("--build-dir", type=Path, help="Reuse an explicitly owned producer scratch directory")
    options = parser.parse_args()
    if not options.local_research:
        parser.error("MoonBit preparation is blocked pending MPSL §14 service-license review; --local-research is for local compiler research only, not publication (see docs/moonbit.md)")
    with tempfile.TemporaryDirectory(prefix="wasm-idle-moonbit-") as temporary:
        scratch = Path(temporary)
        inputs = options.input_dir.resolve() if options.input_dir else scratch / "inputs"
        if not options.input_dir:
            inputs.mkdir()
            with urllib.request.urlopen(ARCHIVE["url"], timeout=60) as response:
                data = response.read(ARCHIVE["bytes"] + 1)
            verify(data, (ARCHIVE["bytes"], ARCHIVE["sha256"]), "official release archive")
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
                for name, pin in FILES.items():
                    content = archive.extractfile("./" + name).read()
                    verify(content, pin, name)
                    target = inputs / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(content)
        build_root = options.build_dir.resolve() if options.build_dir else scratch / "build"
        materialize(inputs, build_root, options.output.resolve())


if __name__ == "__main__":
    main()
