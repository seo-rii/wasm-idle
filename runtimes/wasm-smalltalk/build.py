#!/usr/bin/env python3
"""Package the unchanged Amber compiler/kernel and official AMD loader, offline."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile

HERE = Path(__file__).resolve().parent


def receipt(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def archive_files(pin):
    data = (HERE / "vendor" / pin["archive"]).read_bytes()
    if receipt(data) != {key: pin[key] for key in ("bytes", "sha256")}:
        raise ValueError("Pinned archive changed: " + pin["archive"])
    result = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            parts = PurePosixPath(member.name).parts
            if not parts or parts[0] != "package" or ".." in parts:
                raise ValueError("Unsafe archive path")
            if member.isdir():
                continue
            if not member.isfile() or member.name in result:
                raise ValueError("Unexpected archive entry")
            total += member.size
            if total > 5_000_000:
                raise ValueError("Archive exceeds pinned package bound")
            result[member.name] = archive.extractfile(member).read()
    return result


def produce(target, check=False):
    pin = json.loads((HERE / "upstream.json").read_text())
    amber = archive_files(pin["implementation"])
    loader = archive_files(pin["loader"])
    modules = {}
    for name, data in sorted(amber.items()):
        path = PurePosixPath(name)
        if path.suffix != ".js" or len(path.parts) != 3:
            continue
        folder, stem = path.parts[1], path.stem
        if folder == "base" and stem != "devel":
            modules["amber/" + stem] = data.decode("utf-8")
        elif folder == "src" and (
            stem.startswith("Kernel-") or stem.startswith("Compiler-")
            or stem in ("Platform-Services", "Platform-ImportExport")
        ) and not stem.endswith("-Tests"):
            modules["amber/core/" + stem] = data.decode("utf-8")
    if "amber/lang" not in modules or "amber/core/Compiler-Core" not in modules:
        raise ValueError("Original Amber compiler is missing")
    require_license = (HERE / "LICENSE.requirejs").read_bytes()
    if receipt(require_license) != {
        "bytes": pin["loader"]["licenseBytes"],
        "sha256": pin["loader"]["licenseSha256"],
    }:
        raise ValueError("RequireJS license changed")
    module_bytes = (json.dumps(modules, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    compressed = io.BytesIO()
    with gzip.GzipFile(fileobj=compressed, mode="wb", filename="", mtime=0) as archive:
        archive.write(module_bytes)
    outputs = {
        "amber-modules.json.gz.bin": compressed.getvalue(),
        "require.js": loader["package/require.js"],
        "LICENSE.amber": amber["package/LICENSE"],
        "LICENSE.requirejs": require_license,
    }
    if outputs["LICENSE.amber"] != (HERE / "LICENSE.amber").read_bytes():
        raise ValueError("Amber license changed")
    for name, data in outputs.items():
        path = target / name
        if check:
            if path.read_bytes() != data:
                raise ValueError("Stale Smalltalk asset: " + name)
        else:
            target.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    assets = {name: receipt(data) for name, data in outputs.items() if not name.startswith("LICENSE")}
    assets["amber-modules.json.gz.bin"].update({
        "uncompressedBytes": len(module_bytes),
        "uncompressedSha256": hashlib.sha256(module_bytes).hexdigest(),
    })
    return assets


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-dir", type=Path, default=HERE.parents[1] / "static/wasm-smalltalk")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps(produce(args.target_dir, args.check), sort_keys=True))
