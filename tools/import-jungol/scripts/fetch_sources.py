#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
import tarfile
import zipfile
from pathlib import Path
from urllib.request import Request, urlopen

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/123 Safari/537.36"
)


def is_url(value: str) -> bool:
    return value.startswith("http://") or value.startswith("https://")


def archive_kind(path: Path) -> str | None:
    name = path.name.lower()
    if name.endswith(".zip"):
        return "zip"
    if name.endswith((".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz")):
        return "tar"
    if name.endswith((".7z", ".rar")):
        return "7z"
    return None


def download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req) as response, dest.open("wb") as out:
        shutil.copyfileobj(response, out)
    return dest


def extract(path: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    kind = archive_kind(path)
    if kind == "zip":
        with zipfile.ZipFile(path) as zf:
            zf.extractall(dest)
        return
    if kind == "tar":
        with tarfile.open(path, "r:*") as tf:
            tf.extractall(dest)
        return
    if kind == "7z":
        seven = shutil.which("7z") or shutil.which("7zz")
        if not seven:
            raise RuntimeError(f"7z/7zz is required to extract {path.name}")
        subprocess.run([seven, "x", "-y", f"-o{dest}", str(path)], check=True)
        return
    raise ValueError(f"unsupported archive type: {path}")


def handle_source(raw: str, dest: Path, no_extract: bool) -> None:
    if "=" not in raw:
        raise ValueError(f"source must be role=path-or-url: {raw}")
    role, source = raw.split("=", 1)
    role_dir = dest / role
    role_dir.mkdir(parents=True, exist_ok=True)

    source_path = Path(source)
    if is_url(source):
        filename = source.rstrip("/").split("/")[-1] or f"{role}.bin"
        source_path = download(source, role_dir / filename)
        print(f"[download] {role}: {source_path}")
    elif source_path.is_file():
        copied = role_dir / source_path.name
        if source_path.resolve() != copied.resolve():
            shutil.copy2(source_path, copied)
        source_path = copied
        print(f"[copy] {role}: {source_path}")
    elif source_path.is_dir():
        copied = role_dir / source_path.name
        if copied.exists():
            shutil.rmtree(copied)
        shutil.copytree(source_path, copied)
        print(f"[copytree] {role}: {copied}")
        return
    else:
        raise FileNotFoundError(source)

    if no_extract or not archive_kind(source_path):
        return
    extract_dir = role_dir / f"{source_path.stem}_extract"
    if extract_dir.exists():
        shutil.rmtree(extract_dir)
    extract(source_path, extract_dir)
    print(f"[extract] {role}: {extract_dir}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Download/copy/extract contest source archives.")
    parser.add_argument("sources", nargs="+", help="role=path-or-url entries, e.g. statements=https://...")
    parser.add_argument("--dest", required=True, help="destination work directory")
    parser.add_argument("--no-extract", action="store_true", help="download/copy archives without extracting")
    args = parser.parse_args()

    dest = Path(args.dest).expanduser().resolve()
    dest.mkdir(parents=True, exist_ok=True)
    for source in args.sources:
        handle_source(source, dest, args.no_extract)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
