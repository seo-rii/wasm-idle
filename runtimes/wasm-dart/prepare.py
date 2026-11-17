#!/usr/bin/env python3
"""Extract the pinned, official Dart 3.14.0 browser toolchain (no native SDK)."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
ARCHIVE = {
    "url": "https://storage.googleapis.com/dart-archive/channels/stable/release/3.14.0/dartpad/dartpad.zip",
    "bytes": 40359128,
    "sha256": "a47fad5844f91cfce800a20e2b3442847bf56b3332892cf8000b2abd0dd8a5f9",
}
FILES = {
    "worker.js": (21747, "84d633a69e12f96cb61a46aac4f95e664cd9d779875665795ab701e80892dd21"),
    "worker.wasm": (9758441, "a7cab6f3036ad024adb6f5b77443735a527b2d736eb05f0877ac501577e9675e"),
    "sdk.tar": (8898048, "4a4ee87add3d2436ff79d4960ac7d702d5a829c864ffae9d944ce58bee8b5038"),
    "dart_sdk.js": (10255930, "1fe31df35edc19e06ff959742b356afa47dbf6f741a17040e01551914deb1afa"),
    "sandbox_runtime.js": (255573, "805095f4c6ef2ffaab2b04ecaf25a3ed4f206d7bb40b6d3608aa7c4db6f8e26c"),
    "sandbox.js": (20297, "4597a7d53d45235e36982fb385998d5a71d6abd09f0b24040a76919c8a624451"),
    "version.json": (200, "794a62e3dc4c5da09eef15b794a2d4d1dc86fb20c3cb3505625a1e58483df06d"),
}


def receipt(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Reuse the exact already downloaded release archive")
    parser.add_argument("--output", type=Path, default=ROOT / "../../static/wasm-dart")
    options = parser.parse_args()
    if options.archive:
        if options.archive.stat().st_size != ARCHIVE["bytes"]:
            raise RuntimeError("Dart archive byte length mismatch")
        archive = options.archive.read_bytes()
    else:
        with urllib.request.urlopen(ARCHIVE["url"], timeout=60) as source:
            archive = source.read(ARCHIVE["bytes"] + 1)
    if receipt(archive) != {key: ARCHIVE[key] for key in ("bytes", "sha256")}:
        raise RuntimeError("Dart archive does not match the official SHA-256 receipt")
    output = options.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        for name, (length, sha256) in FILES.items():
            member = source.getinfo("dartpad/" + name)
            if member.file_size != length:
                raise RuntimeError("Unexpected Dart archive member size: " + name)
            data = source.read(member)
            if receipt(data) != {"bytes": length, "sha256": sha256}:
                raise RuntimeError("Dart member does not match its receipt: " + name)
            (output / name).write_bytes(data)
    license_url = "https://raw.githubusercontent.com/dart-lang/sdk/fa8c1270c374c1346931583a17c3b7f278d3822d/LICENSE"
    with urllib.request.urlopen(license_url, timeout=30) as source:
        license_text = source.read(2001)
    if receipt(license_text) != {"bytes": 1502, "sha256": "2cfa3ee8e7512e6d44c854b986510810fadc815f93f890373b3a81c1b6ccd256"}:
        raise RuntimeError("Unexpected Dart BSD license size")
    (output / "LICENSE.txt").write_bytes(license_text)
    manifest = {
        "schemaVersion": 1,
        "implementation": "Official DartPad DDC compiler and web runtime",
        "version": "3.14.0",
        "revision": "fa8c1270c374c1346931583a17c3b7f278d3822d",
        "archive": ARCHIVE,
        "license": {"expression": "BSD-3-Clause", "url": license_url, **receipt(license_text)},
        "assets": {name: {"bytes": length, "sha256": sha256} for name, (length, sha256) in FILES.items()},
    }
    (output / "upstream.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("Prepared original Dart 3.14.0 browser toolchain: " + str(output))


if __name__ == "__main__":
    main()
