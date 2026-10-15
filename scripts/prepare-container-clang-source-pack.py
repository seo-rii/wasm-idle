#!/usr/bin/env python3
"""Preserve pinned local LLVM source objects and producer materials without building.

The independently pinned plan identifies local inputs; this tool never fetches,
changes a checkout, or promotes incomplete source evidence to a release claim.
"""

import argparse
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile


spec = importlib.util.spec_from_file_location(
    "source_materials", Path(__file__).with_name("prepare-container-source-pack.py"))
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
MAX_ARCHIVE = 256 * 1024 * 1024


def git(repository, *arguments):
    return ["git", "--no-replace-objects", "-c", "core.attributesFile=/dev/null",
            "-C", str(repository), *arguments]


def tree(repository, revision, paths=()):
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("an exact Git commit is required")
    actual = subprocess.check_output(git(repository, "rev-parse", revision + "^{commit}"),
                                     env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"}).decode().strip()
    if actual != revision:
        raise ValueError("Git revision is not the requested commit")
    for path in paths:
        source.relative(path)
    raw = subprocess.check_output(git(repository, "ls-tree", "-r", "--long", "-z", revision,
                                      "--", *paths))
    entries = {}
    total = 0
    for record in raw.split(b"\0"):
        if not record:
            continue
        metadata, name = record.split(b"\t", 1)
        mode, kind, oid, size = metadata.split()
        name = source.relative(name.decode())
        if kind != b"blob" or mode not in (b"100644", b"100755", b"120000"):
            raise ValueError(f"unsupported source object (including unexpanded gitlink): {name}")
        entries[name] = {"mode": mode.decode(), "gitBlob": oid.decode(), "bytes": int(size)}
        total += int(size)
    if not entries or len(entries) > 250_000 or total > 4 * 1024**3:
        raise ValueError("source tree is empty or exceeds inventory limits")
    return entries


def archive_tree(repository, revision, prefix, entries, output, paths=(), max_bytes=MAX_ARCHIVE):
    """Stream exact Git blobs with their committed mode and symlink targets.

    Reading objects directly bypasses export-ignore/export-subst attributes,
    filters, the index and working-tree edits. Each blob is checked against its
    tree identity while it enters the compressed archive.
    """
    source.relative(prefix)
    count = 0

    class LimitedWriter:
        def __init__(self, stream):
            self.stream, self.total = stream, 0

        def write(self, data):
            self.total += len(data)
            if self.total > max_bytes:
                raise ValueError("compressed source archive exceeds its byte limit")
            return self.stream.write(data)

        def flush(self):
            self.stream.flush()

    class BlobReader:
        def __init__(self, stream, size):
            self.stream, self.remaining = stream, size
            self.hash = hashlib.sha1(f"blob {size}\0".encode())

        def read(self, amount):
            data = self.stream.read(min(amount, self.remaining))
            self.remaining -= len(data)
            self.hash.update(data)
            return data

    process = subprocess.Popen(git(repository, "cat-file", "--batch"),
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        with Path(output).open("xb") as raw, gzip.GzipFile(
                fileobj=LimitedWriter(raw), filename="", mode="wb", mtime=0, compresslevel=6) as gz:
            with tarfile.open(fileobj=gz, mode="w|", format=tarfile.PAX_FORMAT) as result:
                for name, expected in sorted(entries.items()):
                    process.stdin.write((expected["gitBlob"] + "\n").encode())
                    process.stdin.flush()
                    header = process.stdout.readline(256).decode().strip().split()
                    if header != [expected["gitBlob"], "blob", str(expected["bytes"])]:
                        raise ValueError(f"Git object differs from the source tree: {name}")
                    reader = BlobReader(process.stdout, expected["bytes"])
                    entry = tarfile.TarInfo(prefix + "/" + name)
                    if expected["mode"] == "120000":
                        if expected["bytes"] > 4096:
                            raise ValueError("oversized source symlink target")
                        entry.type = tarfile.SYMTYPE
                        entry.linkname = reader.read(expected["bytes"]).decode()
                        entry.mode = 0o777
                        result.addfile(entry)
                    else:
                        entry.size = expected["bytes"]
                        entry.mode = int(expected["mode"], 8) & 0o777
                        result.addfile(entry, reader)
                    if reader.remaining or reader.hash.hexdigest() != expected["gitBlob"]:
                        raise ValueError(f"Git object content differs from the source tree: {name}")
                    if process.stdout.read(1) != b"\n":
                        raise ValueError("invalid Git object boundary")
                    count += expected["bytes"]
        process.stdin.close()
        error = process.stderr.read(4096).decode(errors="replace")
        if process.wait() != 0:
            raise ValueError(f"Git source read failed: {error}")
    finally:
        if not process.stdin.closed:
            process.stdin.close()
        process.stdout.close()
        process.stderr.close()
        if process.poll() is None:
            process.terminate()
            process.wait()
    return {"path": Path(output).name, **source.identity(output), "revision": revision,
            "prefix": prefix, "files": len(entries), "logicalSourceBytes": count}


def candidate_materials(candidate, expected, materials):
    candidate = Path(candidate)
    receipt = source.pinned_json(candidate / "build-receipt.json", expected)
    if not receipt.get("complete") or not receipt.get("readOnlyInputsUnchanged"):
        raise ValueError("completed unchanged-input candidate receipt required")
    records = receipt["sourcePack"]
    actual_names = {str(path.relative_to(candidate / "source-pack"))
                    for path in (candidate / "source-pack").rglob("*") if path.is_file()}
    if actual_names != set(records):
        raise ValueError("candidate source inventory differs from its pinned receipt")
    for name, identity in records.items():
        source.relative(name)
        materials.add("candidate/" + name, candidate / "source-pack" / name, identity)
    materials.add("candidate/build-receipt.json", candidate / "build-receipt.json")
    for name in ("clang.wasm", "lld.wasm"):
        if source.identity(candidate / name) != receipt["outputs"][name]:
            raise ValueError(f"selected executable differs from candidate receipt: {name}")
    return receipt


def assemble(plan, output):
    output = Path(output)
    if output.exists():
        raise ValueError("output must be new")
    # Three compressed files, each bounded, plus a small material pack. Keep a
    # separate 2 GiB reserve; no expanded LLVM checkout is created.
    if shutil.disk_usage(output.parent).free < 3 * MAX_ARCHIVE + 2 * 1024**3:
        raise ValueError("insufficient free space for bounded source assembly")
    output.mkdir(mode=0o700)
    materials = source.Materials()
    receipt = candidate_materials(plan["candidate"], plan["candidateReceiptSha256"], materials)
    llvm = plan["llvm"]
    if llvm["revision"] != receipt["source"]["revision"]:
        raise ValueError("LLVM source revision differs from candidate")
    evidence = []
    for item in plan.get("materials", []):
        expected = {key: item[key] for key in ("bytes", "sha256")}
        materials.add("evidence/" + source.relative(item["id"]), Path(item["path"]), expected)
        evidence.append({key: value for key, value in item.items() if key != "path"})
    references = []
    for item in plan.get("artifacts", []):
        expected = {key: item[key] for key in ("bytes", "sha256")}
        if source.identity(item["path"]) != expected:
            raise ValueError(f"referenced artifact differs from its independent pin: {item['id']}")
        references.append({key: value for key, value in item.items() if key != "path"})
    entries = tree(llvm["repository"], llvm["revision"])
    roots = sorted({name.split("/")[0] for name in entries})
    archives = []
    for group, paths in (("llvm", ["llvm"]), ("projects", [name for name in roots if name != "llvm"])):
        selected = {name: item for name, item in entries.items() if name.split("/")[0] in paths}
        name = f"llvm-{group}-{llvm['revision']}.tar.gz"
        partial = output / (name + ".partial")
        record = archive_tree(llvm["repository"], llvm["revision"], "llvm-project", selected, partial, paths)
        partial.rename(output / name)
        archives.append({**record, "path": name, "sourceRole": "complete upstream source partition"})
    for repository in plan["recipes"]:
        selected = tree(repository["repository"], repository["revision"], repository["paths"])
        name = source.relative(repository["id"] + ".tar.gz")
        record = archive_tree(repository["repository"], repository["revision"], repository["id"], selected,
                              output / name, repository["paths"])
        materials.add("recipes/" + name, output / name, {k: record[k] for k in ("bytes", "sha256")})
        archives.append({**record, "sourceRole": "producer recipes", "selection": repository["paths"]})
    notices = []
    for name, entry in entries.items():
        if source.NOTICE_NAME.match(Path(name).name) and entry["mode"] != "120000" and entry["bytes"] <= 1024**2:
            data = subprocess.check_output(git(llvm["repository"], "show", llvm["revision"] + ":" + name))
            if hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest() != entry["gitBlob"]:
                raise ValueError("notice blob differs from tree")
            materials.add("notices/llvm-project/" + name, data)
            notices.append(name)
    manifest = {"schemaVersion": 1, "sourceStatus": "incomplete", "completeReleaseSourcePack": False,
                "qualification": "source availability; not a clean build or linked-library correspondence claim",
                "llvm": {"repository": receipt["source"]["repository"], "revision": llvm["revision"],
                         "files": len(entries), "logicalSourceBytes": sum(item["bytes"] for item in entries.values())},
                "archives": archives, "evidence": evidence, "artifactReferences": references,
                "notices": notices, "remainingGaps": plan["remainingGaps"], "materials": materials.index()}
    data = source.json_bytes(manifest)
    (output / "source-pack.json").write_bytes(data)
    materials.add("source-pack.json", data)
    materials.write_tar(output / "materials.tar.gz.partial")
    (output / "materials.tar.gz.partial").rename(output / "materials.tar.gz")
    summary = {"schemaVersion": 1, "sourceStatus": "incomplete", "completeReleaseSourcePack": False,
               "archives": archives, "manifest": source.identity(output / "source-pack.json"),
               "materials": source.identity(output / "materials.tar.gz")}
    (output / "receipt.json").write_bytes(source.json_bytes(summary))
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--plan-sha256", required=True)
    parser.add_argument("--output", required=True, type=Path)
    options = parser.parse_args()
    plan = source.pinned_json(options.plan, options.plan_sha256)
    print(json.dumps(assemble(plan, options.output), indent=2))


if __name__ == "__main__":
    main()
