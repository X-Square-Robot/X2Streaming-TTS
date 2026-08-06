#!/usr/bin/env python3
"""Verify that the external engine checkout matches UPSTREAM_LOCK.json."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "UPSTREAM_LOCK.json"


def _git(path: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(path), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def main() -> int:
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    checkout = ROOT / lock["submodule_path"]
    if not (checkout / ".git").exists():
        print(
            "upstream submodule is not initialized; run "
            "`git submodule update --init --recursive`",
            file=sys.stderr,
        )
        return 2

    actual = _git(checkout, "rev-parse", "HEAD")
    expected = str(lock["commit"])
    if actual != expected:
        print(
            f"upstream commit mismatch: expected {expected}, got {actual}",
            file=sys.stderr,
        )
        return 1

    dirty = _git(checkout, "status", "--short", "--untracked-files=no")
    if dirty:
        print("upstream submodule has tracked modifications:", file=sys.stderr)
        print(dirty, file=sys.stderr)
        return 1

    print(f"verified Qwen3TTS-Streaming at {actual}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
