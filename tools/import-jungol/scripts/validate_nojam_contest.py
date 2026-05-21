#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def has_input_files(path: Path) -> bool:
    return path.is_dir() and any(p.is_file() and p.suffix.lower() == ".in" for p in path.rglob("*"))


def has_output_pair(path: Path) -> bool:
    if not path.is_dir():
        return False
    inputs = set()
    outputs = set()
    for p in path.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in {".in", ".out"}:
            continue
        rel = p.relative_to(path).as_posix()
        stem = rel[: -len(p.suffix)]
        if p.suffix.lower() == ".in":
            inputs.add(stem)
        else:
            outputs.add(stem)
    return bool(inputs & outputs)


def image_refs(problem: dict[str, Any]) -> list[str]:
    text = "\n".join(str(problem.get(key) or "") for key in ("body", "body_en", "input", "input_en", "output", "output_en"))
    return re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', text, flags=re.I)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a nojam contest directory.")
    parser.add_argument("contest", help="contest directory containing problems.json")
    parser.add_argument("--nojam", default=".", help="nojam repository root")
    args = parser.parse_args()

    nojam = Path(args.nojam).expanduser().resolve()
    contest = Path(args.contest).expanduser()
    if not contest.is_absolute():
        contest = (nojam / contest).resolve()

    problems_file = contest / "problems.json"
    if not problems_file.is_file():
        print(f"[error] missing {problems_file}")
        return 1

    problems = json.loads(problems_file.read_text("utf-8"))
    if not isinstance(problems, list):
        print("[error] problems.json must be a list")
        return 1

    errors: list[str] = []
    warnings: list[str] = []
    seen_ids: set[str] = set()
    seen_from: set[str] = set()

    for idx, problem in enumerate(problems):
        label = f"#{idx + 1}:{problem.get('id')}"
        pid = problem.get("id")
        if pid is None:
            errors.append(f"{label} missing id")
            continue
        pid_s = str(pid)
        if pid_s in seen_ids:
            warnings.append(f"{label} duplicate local id {pid_s}")
        seen_ids.add(pid_s)

        source = problem.get("from")
        if not source:
            errors.append(f"{label} missing from")
        elif source in seen_from:
            warnings.append(f"{label} duplicate from {source}")
        seen_from.add(source)

        info = problem.get("info")
        if not isinstance(info, dict):
            errors.append(f"{label} missing info object")
            info = {}
        for key in ("spj", "interactive", "twostep", "competitive", "subtask"):
            if key not in info:
                warnings.append(f"{label} info.{key} missing")

        data_dir = contest / "data" / pid_s
        if info.get("interactive"):
            if problem.get("stop") is not True and not has_input_files(data_dir):
                errors.append(f"{label} interactive but no .in data")
            if problem.get("stop") is not True and not (nojam / "interactor" / pid_s / "Main.cpp").is_file():
                warnings.append(f"{label} interactive without interactor/{pid_s}/Main.cpp")
            if problem.get("stop") is not True and not problem.get("placeholder"):
                warnings.append(f"{label} interactive without placeholder")
        else:
            if problem.get("stop") is not True and not has_output_pair(data_dir):
                errors.append(f"{label} ordinary judge but no .in/.out pair")

        if info.get("spj") and problem.get("stop") is not True and not info.get("interactive"):
            if not (nojam / "spj" / pid_s / "Main.cpp").is_file():
                warnings.append(f"{label} info.spj=true but spj/{pid_s}/Main.cpp missing")

        for ref in image_refs(problem):
            if ref.startswith(("http://", "https://", "/upload/")):
                continue
            local = (contest / ref).resolve()
            if not local.exists():
                warnings.append(f"{label} image reference not found: {ref}")

    for item in errors:
        print(f"[error] {item}")
    for item in warnings:
        print(f"[warn] {item}")
    print(f"[summary] problems={len(problems)} errors={len(errors)} warnings={len(warnings)}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
