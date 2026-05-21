#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

SKIP_DIRS = {".git", "node_modules", "tmp", ".tmp", "__pycache__"}


def iter_problem_files(root: Path) -> list[Path]:
    if root.is_file() and root.name == "problems.json":
        return [root]
    out: list[Path] = []
    for path in root.rglob("problems.json"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        out.append(path)
    return sorted(out)


def rows(root: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for file in iter_problem_files(root):
        try:
            problems = json.loads(file.read_text("utf-8"))
        except Exception as exc:
            print(f"[warn] failed to parse {file}: {exc}")
            continue
        if not isinstance(problems, list):
            continue
        for problem in problems:
            if not isinstance(problem, dict):
                continue
            info = problem.get("info") or {}
            if not info.get("interactive"):
                continue
            out.append(
                {
                    "file": str(file),
                    "id": problem.get("id"),
                    "title": problem.get("title_en") or problem.get("title"),
                    "from": problem.get("from"),
                    "stop": problem.get("stop") is True,
                    "spj": info.get("spj") is True,
                    "placeholder": bool(problem.get("placeholder")),
                    "lang": problem.get("lang") or [],
                }
            )
    return out


def group_key(file: str) -> str:
    parts = Path(file).parts
    if len(parts) >= 3 and parts[0] == "data":
        return "/".join(parts[:3])
    return str(Path(file).parent)


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan nojam problems.json files for interactive entries.")
    parser.add_argument("root", nargs="?", default=".", help="nojam root, data root, or problems.json")
    parser.add_argument("--json", action="store_true", help="print JSON rows")
    parser.add_argument("--group", action="store_true", help="print grouped summary")
    parser.add_argument("--only-stopped", action="store_true", help="only include stopped interactive problems")
    parser.add_argument("--needs-setup", action="store_true", help="only include entries missing stop=false/spj/placeholder")
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    found = rows(root)
    if args.only_stopped:
        found = [row for row in found if row["stop"]]
    if args.needs_setup:
        found = [row for row in found if row["stop"] or not row["spj"] or not row["placeholder"]]

    if args.json:
        print(json.dumps(found, ensure_ascii=False, indent=2))
        return 0

    if args.group:
        groups: dict[str, dict[str, Any]] = defaultdict(lambda: {"total": 0, "stopped": 0, "needs": 0})
        for row in found:
            group = groups[group_key(row["file"])]
            group["total"] += 1
            group["stopped"] += int(row["stop"])
            group["needs"] += int(row["stop"] or not row["spj"] or not row["placeholder"])
        for key in sorted(groups):
            group = groups[key]
            print(f"{key}: total={group['total']} stopped={group['stopped']} needs_setup={group['needs']}")
        return 0

    for row in found:
        flags = []
        if row["stop"]:
            flags.append("stop")
        if not row["spj"]:
            flags.append("no-spj")
        if not row["placeholder"]:
            flags.append("no-placeholder")
        print(f"{row['id']}\t{row['title']}\t{row['from']}\t{','.join(flags) or 'ready'}\t{row['file']}")
    print(f"count={len(found)} stopped={sum(1 for r in found if r['stop'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
