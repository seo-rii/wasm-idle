#!/usr/bin/env python3
"""Assemble pinned source materials offline; never assert release completeness.

Python 3.11+, no third-party dependencies. Input archives are read, never extracted.
The source policy and supplemental inventory require independent caller digests.
"""

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile
import tomllib


CRATES_IO = "registry+https://github.com/rust-lang/crates.io-index"
TREES = {"wasmer-sdk", "wasmer-wasix", "virtual-fs"}
PATH_PACKAGES = {"wasmer-js": "wasmer-sdk", "wasmer-wasix": "wasmer-wasix", "virtual-fs": "virtual-fs"}
NOTICE_NAME = re.compile(r"^(licen[sc]e|unlicense|copying|copyright|notice)([._-].*)?$", re.I)
BRIDGE_RECIPES = (
    "scripts/prepare-container-shell-bridge.mjs",
    "scripts/verify-container-shell-worker-imports.mjs",
    "runtimes/wasm-bash/bridge/README.md",
)
RECIPES = (
    "scripts/prepare-container-shell-sdk-binary.py",
    "scripts/container_shell_sdk_build_guard.py",
    "scripts/inspect-container-shell-sdk.mjs",
    "scripts/package-container-shell-sdk.mjs",
    "scripts/prepare-container-shell-sdk-package.py",
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def identity(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"regular file required: {path}")
    size = 0
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(chunk)
            if size > 512 * 1024 * 1024:
                raise ValueError("input file exceeds 512 MiB")
            value.update(chunk)
    return {"bytes": size, "sha256": value.hexdigest()}


def relative(name):
    path = PurePosixPath(name)
    if (not isinstance(name, str) or not name or name == "." or "\\" in name or "\0" in name
            or path.is_absolute() or str(path) != name or ".." in path.parts):
        raise ValueError(f"canonical relative path required: {name}")
    return name


def pinned_json(path, expected):
    if identity(path)["sha256"] != expected:
        raise ValueError(f"independent digest mismatch: {path}")
    return json.loads(Path(path).read_text())


def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()


def source_subset(source, expected, prefix, subtrees, files, output):
    """Preserve selected source subtrees, with the complete parent archive identity.

    This does not select linked files or infer dependency closure. The caller
    must list whole source/build directories needed by the chosen producer.
    """
    if identity(source) != expected:
        raise ValueError("parent source archive identity mismatch")
    for name in [prefix, *subtrees, *files]:
        relative(name)
    selected, uncompressed = [], 0
    with Path(output).open("xb") as raw, gzip.GzipFile(fileobj=raw, filename="", mode="wb", mtime=0, compresslevel=1) as gz:
        with tarfile.open(source, "r|*") as upstream, tarfile.open(fileobj=gz, mode="w|", format=tarfile.PAX_FORMAT) as result:
            for entry in upstream:
                if not entry.name.startswith(prefix + "/"):
                    continue
                name = relative(entry.name[len(prefix) + 1:])
                if name not in files and not any(name == tree or name.startswith(tree + "/") for tree in subtrees):
                    continue
                if not (entry.isfile() or entry.isdir() or entry.issym() or entry.islnk()):
                    raise ValueError("unsupported source archive entry type")
                selected.append(name)
                uncompressed += entry.size
                if len(selected) > 100_000 or uncompressed > 512 * 1024 * 1024:
                    raise ValueError("source subset bound")
                entry.uid = entry.gid = entry.mtime = 0
                entry.uname = entry.gname = ""
                entry.pax_headers = {}
                result.addfile(entry, upstream.extractfile(entry) if entry.isfile() else None)
            if not all(name in selected for name in files) or not all(any(name.startswith(tree + "/") for name in selected) for tree in subtrees):
                raise ValueError("required source subtree or file absent")
            provenance = {"parentArchive": expected, "prefix": prefix, "subtrees": subtrees,
                          "files": files, "entries": len(selected), "uncompressedBytes": uncompressed}
            data = json_bytes(provenance)
            entry = tarfile.TarInfo("SOURCE-SUBSET.json")
            entry.size, entry.mode = len(data), 0o644
            result.addfile(entry, io.BytesIO(data))
    return {**provenance, "archive": identity(output)}


class Materials:
    def __init__(self):
        self.files = {}

    def add(self, name, source, expected=None):
        relative(name)
        actual = ({"bytes": len(source), "sha256": digest(source)}
                  if isinstance(source, bytes) else identity(source))
        if expected is not None and actual != expected:
            raise ValueError(f"input identity mismatch: {name}")
        if name in self.files:
            if self.files[name][1] != actual:
                raise ValueError(f"conflicting material: {name}")
            return actual
        if len(self.files) >= 20_000:
            raise ValueError("source material file limit")
        self.files[name] = (source, actual)
        return actual

    def index(self):
        return {name: value[1] for name, value in sorted(self.files.items())}

    def write_tar(self, path):
        # Hash the bytes again as they enter the archive; changing inputs cannot
        # leave a successful pack containing bytes different from its inventory.
        class Reader:
            def __init__(self, stream):
                self.stream, self.hash, self.size = stream, hashlib.sha256(), 0

            def read(self, count):
                data = self.stream.read(count)
                self.hash.update(data)
                self.size += len(data)
                return data

        with Path(path).open("xb") as raw, gzip.GzipFile(
                fileobj=raw, filename="", mode="wb", compresslevel=1, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as archive:
                for name, (source, expected) in sorted(self.files.items()):
                    info = tarfile.TarInfo(name)
                    info.size, info.mode, info.mtime = expected["bytes"], 0o644, 0
                    info.uid = info.gid = 0
                    with (io.BytesIO(source) if isinstance(source, bytes) else Path(source).open("rb")) as stream:
                        reader = Reader(stream)
                        archive.addfile(info, reader)
                        if (reader.size != expected["bytes"] or reader.hash.hexdigest() != expected["sha256"]
                                or stream.read(1)):
                            raise ValueError(f"input changed while packaging: {name}")


def scan_archive(path, prefix, materials, component, selected_notices=None):
    """Read bounded metadata and notice files; never follow archive links."""
    relative(prefix)
    result = {"component": component, "declaredLicense": None, "notices": []}
    selected = set(selected_notices) if selected_notices is not None else None
    for name in selected or ():
        relative(name)
    total, seen = 0, set()
    with tarfile.open(path, "r|*") as archive:
        for number, entry in enumerate(archive):
            if number >= 200_000:
                raise ValueError("archive entry limit")
            if not entry.isfile() or not entry.name.startswith(prefix + "/"):
                continue
            name = relative(entry.name[len(prefix) + 1:])
            wanted_notice = name in selected if selected is not None else (
                bool(NOTICE_NAME.match(PurePosixPath(name).name)) or
                any(part.lower() in {"licenses", "licences"} for part in PurePosixPath(name).parts[:-1]))
            if not wanted_notice and name not in ("Cargo.toml", "package.json", ".cargo_vcs_info.json"):
                continue
            if name in seen or entry.size > 4 * 1024 * 1024:
                raise ValueError("duplicate or oversized archive metadata")
            seen.add(name)
            total += entry.size
            if total > 32 * 1024 * 1024:
                raise ValueError("notice byte limit")
            data = archive.extractfile(entry).read()
            if name == "Cargo.toml":
                package = tomllib.loads(data.decode()).get("package", {})
                result["packageName"] = package.get("name")
                result["packageVersion"] = package.get("version")
                result["declaredLicense"] = package.get("license")
                result["licenseFile"] = package.get("license-file")
                result["repository"] = package.get("repository")
            elif name == "package.json" and result["declaredLicense"] is None:
                result["declaredLicense"] = json.loads(data).get("license")
            elif name == ".cargo_vcs_info.json":
                result["vcs"] = json.loads(data)
            if wanted_notice:
                target = f"notices/{component}/{name}"
                materials.add(target, data)
                result["notices"].append(target)
                if selected is not None:
                    selected.remove(name)
                    if not selected:
                        break
    if selected:
        raise ValueError(f"missing selected notice files: {sorted(selected)}")
    # Cargo's explicitly declared license file can have any filename and may
    # precede Cargo.toml in the archive. Preserve it independently of heuristics.
    license_file = result.get("licenseFile")
    if isinstance(license_file, str) and license_file not in seen:
        relative(license_file)
        with tarfile.open(path, "r:*") as archive:
            entry = archive.getmember(prefix + "/" + license_file)
            if not entry.isfile() or entry.size > 4 * 1024 * 1024:
                raise ValueError("declared license must be a bounded regular file")
            target = f"notices/{component}/{license_file}"
            materials.add(target, archive.extractfile(entry).read())
            result["notices"].append(target)
    result["notices"].sort()
    return result


def registry_materials(lock, cache, materials, records, scope):
    for package in lock["package"]:
        source = package.get("source")
        if source is None:
            continue
        if source != CRATES_IO:
            raise ValueError(f"unsupported dependency source: {source}")
        key = f"{package['name']}-{package['version']}"
        relative(key)
        path = cache / (key + ".crate")
        expected = identity(path)
        if expected["sha256"] != package["checksum"]:
            raise ValueError(f"Cargo.lock checksum mismatch: {key}")
        materials.add(f"registry/{key}.crate", path, expected)
        if key in records:
            if records[key]["archive"] != expected:
                raise ValueError(f"conflicting locked package: {key}")
            records[key]["locks"].append(scope)
        else:
            item = scan_archive(path, key, materials, key)
            if item.get("packageName") != package["name"] or item.get("packageVersion") != package["version"]:
                raise ValueError(f"crate package metadata mismatch: {key}")
            item.update(archive=expected, locks=[scope], source=source)
            records[key] = item


def match_published_source(crate, upstream, prefix):
    """Match every published source file when a crate has no VCS metadata.

    Cargo's normalized manifest, publication lock, and VCS record are metadata;
    the original manifest must match along with all source/build/example files.
    The complete published archive, including those metadata files, is retained.
    """
    relative(prefix)
    matched = []
    with tarfile.open(crate, "r:*") as published, tarfile.open(upstream, "r:*") as original:
        for entry in published:
            if not entry.isfile():
                continue
            name = relative(entry.name.split("/", 1)[1])
            if name in {"Cargo.toml", "Cargo.lock", ".cargo_vcs_info.json"}:
                continue
            target = prefix + "/" + ("Cargo.toml" if name == "Cargo.toml.orig" else name)
            source = original.getmember(target)
            if not source.isfile() or source.size != entry.size or source.size > 16 * 1024 * 1024:
                raise ValueError(f"published source shape mismatch: {name}")
            if published.extractfile(entry).read() != original.extractfile(source).read():
                raise ValueError(f"published source bytes mismatch: {name}")
            matched.append(name)
    if "Cargo.toml.orig" not in matched or len(matched) < 2:
        raise ValueError("original manifest and source files required")
    return sorted(matched)


def copy_prepared(policy, materials):
    root = Path(policy["preparedSource"])
    if set(policy["sourceTrees"]) != TREES:
        raise ValueError("requires explicit SDK, WASIX and virtual-fs source trees")
    for tree in sorted(TREES):
        directory = root / tree
        expected = {name: value for name, value in policy["sourcePins"].items()
                    if name.startswith(str(directory) + "/")}
        actual = set()
        for path in sorted(directory.rglob("*")):
            if path.is_symlink():
                raise ValueError("prepared source symlink")
            if path.is_file():
                actual.add(str(path))
                if str(path) not in expected:
                    raise ValueError(f"unlisted prepared source: {path}")
                materials.add(f"prepared-source/{tree}/{path.relative_to(directory).as_posix()}", path, expected[str(path)])
        if actual != set(expected) or not actual:
            raise ValueError(f"prepared source inventory mismatch: {tree}")
    receipt_path = root / "receipt.json"
    materials.add("prepared-source/receipt.json", receipt_path, policy["sourcePins"][str(receipt_path)])
    return root, json.loads(receipt_path.read_text())


def rust_materials(config, archives, materials, cache, records):
    item = archives[config["archive"]]
    archive_path, expected = item["path"], item["identity"]
    prefix = config["prefix"]
    relative(prefix)
    installed = Path(config["installedRoot"])
    if installed.is_symlink() or any(p.is_symlink() for p in installed.rglob("*")):
        raise ValueError("Rust source symlink")
    seen, lock = set(), None
    with tarfile.open(archive_path, "r|*") as archive:
        for member in archive:
            if not member.isfile() or not member.name.startswith(prefix + "/"):
                continue
            name = relative(member.name[len(prefix) + 1:])
            if member.size > 16 * 1024 * 1024 or name in seen:
                raise ValueError("Rust component source bounds")
            seen.add(name)
            data = archive.extractfile(member).read()
            if identity(installed / name) != {"bytes": len(data), "sha256": digest(data)}:
                raise ValueError(f"installed Rust source differs from component archive: {name}")
            if name == "library/Cargo.lock":
                lock = tomllib.loads(data.decode())
                materials.add("locks/rust-library-Cargo.lock", data)
    actual = {p.relative_to(installed).as_posix() for p in installed.rglob("*") if p.is_file()}
    if actual != seen or lock is None:
        raise ValueError("installed Rust component source inventory differs")
    registry_materials(lock, cache, materials, records, "rust-library-Cargo.lock")
    return {"archive": expected, "verifiedInstalledFiles": len(seen),
            "lockPackages": len(lock["package"]), "status": "installed-source-matches-pinned-component"}


def prepare(args):
    output = args.output.absolute()
    if output.exists() or output.is_symlink():
        raise ValueError("output must be fresh")
    policy = pinned_json(args.source_policy, args.source_policy_sha256)
    supplement = pinned_json(args.supplements, args.supplements_sha256)
    materials, records = Materials(), {}
    prepared, receipt = copy_prepared(policy, materials)
    portable_policy = {"sourceCommit": policy["sourceCommit"], "sourceTrees": sorted(TREES),
                       "sourcePolicyIdentity": identity(args.source_policy)}
    materials.add("provenance/sdk-source.json", json_bytes(portable_policy))
    inputs = {key: Path(value) for key, value in (item.split("=", 1) for item in args.input_archive)}
    if set(inputs) != {item["name"] for item in receipt["inputs"]}:
        raise ValueError("exact upstream input archive mapping required")
    components = []
    for item in receipt["inputs"]:
        key, path = item["name"], inputs[item["name"]]
        materials.add(f"upstream/{key}.tar.gz", path, {k: item[k] for k in ("bytes", "sha256")})
        prefix = (f"wasmer-sdk-{receipt['sdkSourceRevision']}" if key == "wasmer-sdk" else f"{key}-0.601.0")
        components.append(scan_archive(path, prefix, materials, key))
    bridge = args.bridge_repository / "runtimes/wasm-bash/bridge"
    for name, sha in receipt["patches"].items():
        relative(name)
        rel = ("patches/" if name.endswith(".patch") else "") + name
        path = bridge / rel
        expected = identity(path)
        if expected["sha256"] != sha:
            raise ValueError(f"bridge source differs from prepared receipt: {name}")
        materials.add("repository/runtimes/wasm-bash/bridge/" + rel, path, expected)
    for name in BRIDGE_RECIPES:
        materials.add("repository/" + name, args.bridge_repository / name)
    for name in RECIPES:
        materials.add("repository/" + name, args.recipe_repository / name)
    materials.add("repository/scripts/prepare-container-source-pack.py", Path(__file__))
    materials.add("repository/docs/container-sources.md", Path(__file__).resolve().parent.parent / "docs/container-sources.md")
    lock = tomllib.loads((prepared / "wasmer-sdk/Cargo.lock").read_text())
    local = {item["name"] for item in lock["package"] if not item.get("source")}
    if local != set(PATH_PACKAGES):
        raise ValueError("unmapped Cargo path dependency")
    materials.add("locks/sdk-Cargo.lock", prepared / "wasmer-sdk/Cargo.lock")
    registry_materials(lock, args.registry_cache, materials, records, "sdk-Cargo.lock")
    archives, supplemental, published_matches = {}, [], []
    for item in supplement["materials"]:
        name, path = relative(item["id"]), Path(item["path"])
        expected = {key: item[key] for key in ("bytes", "sha256")}
        target = "supplements/" + name
        materials.add(target, path, expected)
        portable = {key: value for key, value in item.items() if key != "path"}
        supplemental.append(portable)
        if item.get("archivePrefix"):
            archives[name] = {"path": path, "identity": expected}
            component = scan_archive(path, item["archivePrefix"], materials, name, item.get("noticePaths"))
            components.append(component)
            if item.get("publishedCrate"):
                published_matches.append((item["publishedCrate"], path, expected, component))
    rust = rust_materials(supplement["rustSource"], archives, materials, args.registry_cache, records) if supplement.get("rustSource") else None
    for published, path, expected, component in published_matches:
        relative(published["name"])
        record = records[published["name"]]
        record["matchedUpstreamSourceFiles"] = match_published_source(
            args.registry_cache / (published["name"] + ".crate"), path, published["prefix"])
        record["upstreamSourceArchive"] = expected
        record["notices"].extend(component["notices"])
    # Supplements may supply upstream notice text omitted from a crate, but only
    # for the exact revision recorded inside that immutable crate archive.
    for notice in supplemental:
        if not notice.get("noticeForVcsRevision"):
            continue
        for item in [*components, *records.values()]:
            if item.get("vcs", {}).get("git", {}).get("sha1") == notice["noticeForVcsRevision"]:
                item["notices"].append("supplements/" + notice["id"])
    bash_receipt_path = args.bash_build / "build-receipt.json"
    bash = pinned_json(bash_receipt_path, args.bash_receipt_sha256)
    materials.add("bash/build-receipt.json", bash_receipt_path)
    expected = {key: bash["artifacts"]["sourceMaterials"][key] for key in ("bytes", "sha256")}
    materials.add("bash/source-materials.tar.gz", args.bash_build / "source-materials.tar.gz", expected)
    license_identity = {key: bash["artifacts"]["license"][key] for key in ("bytes", "sha256")}
    materials.add("notices/bash/LICENSE.txt", args.bash_build / "candidate/LICENSE.txt", license_identity)
    components.append({"component": "bash", "declaredLicense": bash["artifacts"]["license"]["spdx"],
                       "notices": ["notices/bash/LICENSE.txt"], "sourceRevision": bash["sourceRevision"]})
    missing = sorted(item["component"] for item in [*components, *records.values()] if not item["notices"])
    gaps = list(supplement.get("remainingGaps", []))
    if rust is None:
        gaps.append("Rust build-std component source and library lock closure were not provided")
    if missing:
        gaps.append("Some source archives have no separately identified notice text; inspect their embedded source: " + ", ".join(missing))
    gaps.append("Source-to-binary correspondence and notice applicability still require release review; source availability does not establish either")
    manifest = {"schemaVersion": 1, "sourceStatus": "incomplete", "completeReleaseSourcePack": False,
                "sourceAvailability": "verified-materials-for-listed-inputs",
                "inputIdentities": {"sdkSourcePolicy": identity(args.source_policy),
                                    "supplements": identity(args.supplements), "bashReceipt": identity(bash_receipt_path)},
                "sdk": portable_policy, "rust": rust, "bashSourceRevision": bash["sourceRevision"],
                "dependencyScope": "complete SDK and supplied Rust library Cargo.lock superset, including unused targets and development packages",
                "registryPackages": records, "components": components, "supplements": supplemental,
                "remainingGaps": gaps, "files": materials.index()}
    lines = ["# Container source materials", "", "Source status: incomplete. This inventory is not a license or release approval.", "",
             "Original source archives, declared license metadata, and identified notice texts are preserved.",
             "The Cargo.lock inventory includes packages that may not be linked into the selected binary.", "", "## Components", ""]
    for item in sorted([*components, *records.values()], key=lambda value: value["component"]):
        lines += [f"- {item['component']}: declared license `{item.get('declaredLicense') or 'unspecified'}`; " +
                  (", ".join(item["notices"]) if item["notices"] else "notice text requires review")]
    lines += ["", "## Remaining release review", ""] + ["- " + gap for gap in gaps]
    notices = ("\n".join(lines) + "\n").encode()
    materials.add("NOTICES.md", notices)
    manifest["files"] = materials.index()
    encoded = json_bytes(manifest)
    materials.add("source-pack.json", encoded)
    # Refuse insufficient space before writing; archives are streamed directly
    # from their read-only inputs, with no duplicated extraction/staging tree.
    available = os.statvfs(output.parent).f_bavail * os.statvfs(output.parent).f_frsize
    maximum = sum(value[1]["bytes"] for value in materials.files.values())
    if available < maximum + 2 * 1024**3:
        raise ValueError("source pack requires input byte budget plus 2 GiB free reserve")
    output.mkdir(mode=0o700)
    temporary = output / ".source-pack.tar.gz.partial"
    try:
        materials.write_tar(temporary)
        os.replace(temporary, output / "source-pack.tar.gz")
        (output / "source-pack.json").write_bytes(encoded)
        (output / "NOTICES.md").write_bytes(notices)
        result = {"schemaVersion": 1, "sourceStatus": "incomplete", "pack": identity(output / "source-pack.tar.gz"),
                  "manifest": identity(output / "source-pack.json"), "notices": identity(output / "NOTICES.md"),
                  "registryPackages": len(records), "missingNoticeTexts": len(missing)}
        (output / "receipt.json").write_bytes(json_bytes(result))
        return result
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def main():
    if sys.argv[1:2] == ["subset"]:
        parser = argparse.ArgumentParser(description="Create a deterministic source subtree archive from a pinned parent")
        parser.add_argument("--source", type=Path, required=True)
        parser.add_argument("--source-sha256", required=True)
        parser.add_argument("--prefix", required=True)
        parser.add_argument("--tree", action="append", default=[])
        parser.add_argument("--file", action="append", default=[])
        parser.add_argument("--output", type=Path, required=True)
        args = parser.parse_args(sys.argv[2:])
        expected = identity(args.source)
        expected["sha256"] = args.source_sha256
        print(json.dumps(source_subset(args.source, expected, args.prefix, args.tree, args.file, args.output), sort_keys=True))
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-policy", type=Path, required=True)
    parser.add_argument("--source-policy-sha256", required=True)
    parser.add_argument("--bridge-repository", type=Path, required=True)
    parser.add_argument("--recipe-repository", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--input-archive", action="append", required=True, metavar="NAME=PATH")
    parser.add_argument("--registry-cache", type=Path, required=True)
    parser.add_argument("--bash-build", type=Path, required=True)
    parser.add_argument("--bash-receipt-sha256", required=True)
    parser.add_argument("--supplements", type=Path, required=True)
    parser.add_argument("--supplements-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    print(json.dumps(prepare(parser.parse_args()), sort_keys=True))


if __name__ == "__main__":
    main()
