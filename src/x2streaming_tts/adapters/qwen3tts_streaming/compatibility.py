"""Compatibility checks for the pinned external engine checkout."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class UpstreamCompatibility:
    expected_commit: str
    actual_commit: str
    checkout: Path

    @property
    def compatible(self) -> bool:
        return self.expected_commit == self.actual_commit


def inspect_upstream(repository_root: Path) -> UpstreamCompatibility:
    root = Path(repository_root).resolve()
    lock = json.loads((root / "UPSTREAM_LOCK.json").read_text(encoding="utf-8"))
    checkout = root / str(lock["submodule_path"])
    if not (checkout / ".git").exists():
        raise RuntimeError(
            "Qwen3TTS-Streaming submodule is not initialized; run "
            "`git submodule update --init --recursive`"
        )
    actual = subprocess.run(
        ["git", "-C", str(checkout), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    return UpstreamCompatibility(
        expected_commit=str(lock["commit"]),
        actual_commit=actual,
        checkout=checkout,
    )


def require_compatible_upstream(repository_root: Path) -> Path:
    result = inspect_upstream(repository_root)
    if not result.compatible:
        raise RuntimeError(
            "unsupported Qwen3TTS-Streaming commit: "
            f"expected {result.expected_commit}, got {result.actual_commit}"
        )
    return result.checkout
