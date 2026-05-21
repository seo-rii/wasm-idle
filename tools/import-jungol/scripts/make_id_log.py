#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def count_problems(target: Path) -> int:
    if target.is_file() and target.name == "problems.json":
        files = [target]
    else:
        files = sorted(target.rglob("problems.json"))
    total = 0
    for file in files:
        data = json.loads(file.read_text("utf-8"))
        if isinstance(data, list):
            total += len(data)
    return total


def main() -> int:
    parser = argparse.ArgumentParser(description="Create nojam/log/id.log from a user-approved start ID.")
    parser.add_argument("--nojam", default=".", help="nojam repository root")
    parser.add_argument("--target", required=True, help="contest root or problems.json to count")
    parser.add_argument("--start", required=True, type=int, help="first Jungol ID approved by the user")
    parser.add_argument("--count", type=int, help="override problem count")
    parser.add_argument("--margin", type=int, default=10, help="extra IDs for conflicts/duplicates")
    parser.add_argument("--write", action="store_true", help="write nojam/log/id.log")
    args = parser.parse_args()

    nojam = Path(args.nojam).expanduser().resolve()
    target = Path(args.target).expanduser()
    if not target.is_absolute():
        target = (nojam / target).resolve()

    count = args.count if args.count is not None else count_problems(target)
    if count <= 0:
        raise SystemExit("problem count must be positive")
    end = args.start + count + max(args.margin, 0) - 1
    line = f"{args.start}-{end}\n"
    print(line, end="")

    if args.write:
        log_dir = nojam / "log"
        log_dir.mkdir(parents=True, exist_ok=True)
        (log_dir / "id.log").write_text(line, "utf-8")
        print(f"[write] {log_dir / 'id.log'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
