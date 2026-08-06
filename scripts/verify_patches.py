#!/usr/bin/env python3
"""Verify the locked upstream patch series without modifying the submodule."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    lock = json.loads((ROOT / "UPSTREAM_LOCK.json").read_text(encoding="utf-8"))
    upstream = ROOT / str(lock["submodule_path"])
    patch_dir = ROOT / "patches" / "upstream" / str(lock["commit"])
    patches = sorted(patch_dir.glob("*.patch"))
    if not patches:
        print(f"no patches found in {patch_dir}", file=sys.stderr)
        return 2

    digest = hashlib.sha256()
    with tempfile.TemporaryDirectory(prefix="x2-patch-index-") as temp_dir:
        env = {"GIT_INDEX_FILE": str(Path(temp_dir) / "index")}
        inherited_env = os.environ.copy()
        inherited_env.update(env)
        initialized = subprocess.run(
            ["git", "-C", str(upstream), "read-tree", "HEAD"],
            text=True,
            capture_output=True,
            env=inherited_env,
        )
        if initialized.returncode:
            print(initialized.stderr, file=sys.stderr)
            return 1
        for patch in patches:
            digest.update(patch.read_bytes())
            completed = subprocess.run(
                ["git", "-C", str(upstream), "apply", "--cached", str(patch)],
                text=True,
                capture_output=True,
                env=inherited_env,
            )
            if completed.returncode:
                print(f"patch does not apply cleanly: {patch.name}", file=sys.stderr)
                print(completed.stderr, file=sys.stderr)
                return 1

    actual = digest.hexdigest()
    expected = str(lock["patch_series_sha256"])
    if actual != expected:
        print(
            f"patch hash mismatch: expected {expected}, got {actual}",
            file=sys.stderr,
        )
        return 1

    print(f"verified {len(patches)} upstream patch(es): {actual}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
