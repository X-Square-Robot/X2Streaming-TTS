from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_upstream_lock_uses_full_commit() -> None:
    lock = json.loads((ROOT / "UPSTREAM_LOCK.json").read_text(encoding="utf-8"))

    assert lock["repository"] == (
        "https://github.com/X-Square-Robot/Qwen3TTS-Streaming.git"
    )
    assert len(lock["commit"]) == 40
    int(lock["commit"], 16)


def test_core_package_does_not_vendor_upstream_engine() -> None:
    package = ROOT / "src/x2streaming_tts"

    forbidden = {
        "engine_loop.py",
        "executor.py",
        "grpc_server.py",
        "websocket_server.py",
        "tts_pb2.py",
    }
    assert not forbidden.intersection(path.name for path in package.rglob("*.py"))


def test_repository_excludes_research_asset_directories() -> None:
    for name in ("paper_submission", "datasets", "results", "research"):
        assert not (ROOT / name).exists()


def test_source_distribution_excludes_external_submodule() -> None:
    project = (ROOT / "pyproject.toml").read_text(encoding="utf-8")

    assert "[tool.hatch.build.targets.sdist]" in project
    assert '"/third_party"' in project


def test_core_contains_no_historical_experiment_or_audio_join_paths() -> None:
    package = ROOT / "src/x2streaming_tts"
    source = "\n".join(
        path.read_text(encoding="utf-8") for path in package.rglob("*.py")
    )

    for forbidden in (
        "QKConsensusState",
        "build_qk_attention_bias",
        "talker_kv_tail",
        "carry_talker_kv",
        "TightEOSJoin",
    ):
        assert forbidden not in source
    assert not (package / "audio_join").exists()
